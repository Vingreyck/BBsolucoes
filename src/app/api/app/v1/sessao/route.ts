import { exigirVersaoMinima } from "@/app-movel/versao";
import { and, eq } from "drizzle-orm";

import { cpfValido, normalizarCpf } from "@/auth/cpf";
import { HASH_FANTASMA, verificarSenha } from "@/auth/senha";
import { abrirDesafio, DESAFIO_MINUTOS, dispositivoConhecido, mfaAtivoNoApp } from "@/auth/mfa";
import { encerrarSessaoApp } from "@/auth/sessao-app";
import { db } from "@/db";
import { usuario as usuarioTable } from "@/db/schema";
import { respostaDeEntrada } from "@/app-movel/entrada";
import {
  ehUuid,
  falha,
  ipDe,
  json,
  lerJson,
  muitasTentativas,
  semConteudo,
  texto,
} from "@/app-movel/http";
import { consumir, MINUTO, zerar } from "@/app-movel/limitador";
import { ehPapelApp } from "@/app-movel/permissoes";
import { registrarSeguranca } from "@/sistema/seguranca";

const PAPEL_ROTULO: Record<string, string> = { vendedor: "vendas", estoque: "estoque" };

/**
 * Entrar no app: empresa + CPF + senha.
 *
 * A empresa vem pelo `id` que o app guardou na primeira tela, e não pelo
 * código: trocar o código da empresa não pode deslogar a equipe inteira.
 *
 * A ordem das conferências importa. A senha é conferida **antes** de dizer se
 * o cadastro está pendente ou desativado — senão bastaria saber o CPF de
 * alguém para descobrir a situação da conta dele. E o CPF inexistente passa
 * pelo mesmo scrypt que uma senha errada, para o tempo de resposta não
 * denunciar quem está cadastrado.
 */
export async function POST(req: Request) {
  const velho = exigirVersaoMinima(req);
  if (velho) return velho;
  const ip = ipDe(req);
  const porIp = consumir(`login:${ip}`, 30, 15 * MINUTO);
  if (!porIp.ok) {
    registrarSeguranca("login_bloqueado", { origem: "app", ip });
    return muitasTentativas(porIp.tenteEmSegundos);
  }

  const corpo = await lerJson(req);
  const empresaId = texto(corpo?.empresaId, 64);
  const cpf = normalizarCpf(texto(corpo?.cpf, 20));
  const senha = typeof corpo?.senha === "string" ? corpo.senha.slice(0, 200) : "";
  const dispositivo = texto(corpo?.dispositivo, 120) || null;

  if (!ehUuid(empresaId) || !cpfValido(cpf) || !senha) {
    return falha(400, "validacao", "Confira o CPF e a senha.");
  }

  const chaveCpf = `login:${empresaId}:${cpf}`;
  const porCpf = consumir(chaveCpf, 8, 15 * MINUTO);
  if (!porCpf.ok) {
    registrarSeguranca("login_bloqueado", { origem: "app", ip, quem: cpf });
    return muitasTentativas(porCpf.tenteEmSegundos);
  }

  const encontrado = await db.query.usuario.findFirst({
    where: and(eq(usuarioTable.empresaId, empresaId), eq(usuarioTable.cpf, cpf)),
    with: { empresa: { columns: { id: true, nome: true, ativa: true } } },
  });

  const { confere, novoHash } = await verificarSenha(senha, encontrado?.senhaHash ?? HASH_FANTASMA);
  if (!encontrado || !confere) {
    registrarSeguranca("login_falhou", { origem: "app", ip, quem: cpf });
    return falha(401, "credenciais", "CPF ou senha não conferem.");
  }

  // Hash de custo antigo: regrava com o de hoje, na única hora em que o
  // servidor vê a senha (ver `@/auth/senha`).
  if (novoHash) {
    await db.update(usuarioTable).set({ senhaHash: novoHash }).where(eq(usuarioTable.id, encontrado.id));
    registrarSeguranca("senha_regravada", { origem: "app", ip, usuarioId: encontrado.id });
  }

  if (!encontrado.aprovadoEm) {
    return falha(
      403,
      "aguardando_aprovacao",
      `Seu cadastro ainda espera a liberação de um administrador da ${encontrado.empresa.nome}.`,
    );
  }
  if (!encontrado.ativo) {
    return falha(403, "conta_desativada", "Sua conta está desativada. Fale com o administrador.");
  }
  if (!encontrado.empresa.ativa) {
    return falha(403, "empresa_inativa", "O acesso da sua empresa está suspenso.");
  }
  if (!ehPapelApp(encontrado.papel) || !encontrado.cpf) {
    const rotulo = PAPEL_ROTULO[encontrado.papel] ?? encontrado.papel;
    return falha(
      403,
      "papel_sem_app",
      `O seu perfil (${rotulo}) usa o Selebi pelo navegador, não pelo app.`,
    );
  }

  zerar(chaveCpf);

  /**
   * Segundo fator no app — só com `MFA_APP=1`, que fica desligado até a versão
   * do app com a tela do código estar na loja (senão os técnicos ficariam sem
   * entrar). Ligado: aparelho que o app já provou (`dispositivoToken`, 30 dias)
   * entra direto; qualquer outro recebe um desafio e termina em
   * `POST /sessao/mfa`. Quem ainda não cadastrou o aplicativo recebe a chave.
   */
  let mfaValidaAte: Date | undefined;
  if (mfaAtivoNoApp()) {
    const conhecido = await dispositivoConhecido(encontrado.id, texto(corpo?.dispositivoToken, 100) || undefined);
    if (conhecido) {
      mfaValidaAte = conhecido.expiraEm;
    } else {
      const { token, cadastro } = await abrirDesafio({ usuarioId: encontrado.id, origem: "app", dispositivo });
      registrarSeguranca("mfa_pedido", { origem: "app", ip, usuarioId: encontrado.id });
      return falha(403, "mfa_necessaria", "Digite o código do aplicativo autenticador.", {
        desafio: token,
        cadastro,
        expiraEmMinutos: DESAFIO_MINUTOS,
      });
    }
  }

  registrarSeguranca("login_ok", { origem: "app", ip, usuarioId: encontrado.id });
  return respostaDeEntrada(
    { ...encontrado, papel: encontrado.papel, cpf: encontrado.cpf, empresa: encontrado.empresa },
    dispositivo,
    mfaValidaAte,
  );
}

/** Sair. Não exige sessão válida: sair de uma sessão vencida também é sair. */
export async function DELETE(req: Request) {
  await encerrarSessaoApp(req);
  return semConteudo();
}
