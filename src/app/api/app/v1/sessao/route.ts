import { and, eq } from "drizzle-orm";

import { cpfValido, normalizarCpf } from "@/auth/cpf";
import { conferirSenha, HASH_FANTASMA } from "@/auth/senha";
import { criarSessaoApp, encerrarSessaoApp } from "@/auth/sessao-app";
import { db } from "@/db";
import { usuario as usuarioTable } from "@/db/schema";
import { perfilDoUsuario } from "@/app-movel/autenticacao";
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
  const ip = ipDe(req);
  const porIp = consumir(`login:${ip}`, 30, 15 * MINUTO);
  if (!porIp.ok) return muitasTentativas(porIp.tenteEmSegundos);

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
  if (!porCpf.ok) return muitasTentativas(porCpf.tenteEmSegundos);

  const encontrado = await db.query.usuario.findFirst({
    where: and(eq(usuarioTable.empresaId, empresaId), eq(usuarioTable.cpf, cpf)),
    with: { empresa: { columns: { id: true, nome: true, ativa: true } } },
  });

  const confere = await conferirSenha(senha, encontrado?.senhaHash ?? HASH_FANTASMA);
  if (!encontrado || !confere) {
    return falha(401, "credenciais", "CPF ou senha não conferem.");
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
  const { token, expiraEm } = await criarSessaoApp(encontrado.id, dispositivo);

  return json({
    token,
    expiraEm: expiraEm.toISOString(),
    usuario: perfilDoUsuario({
      id: encontrado.id,
      nome: encontrado.nome,
      cpf: encontrado.cpf,
      email: encontrado.email,
      papel: encontrado.papel,
      empresaId: encontrado.empresa.id,
      empresaNome: encontrado.empresa.nome,
      deveTrocarSenha: encontrado.deveTrocarSenha,
      sessaoId: "",
    }),
  });
}

/** Sair. Não exige sessão válida: sair de uma sessão vencida também é sair. */
export async function DELETE(req: Request) {
  await encerrarSessaoApp(req);
  return semConteudo();
}
