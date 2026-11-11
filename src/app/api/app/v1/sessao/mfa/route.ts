import { and, eq } from "drizzle-orm";

import { respostaDeEntrada } from "@/app-movel/entrada";
import { ehUuid, falha, ipDe, lerJson, muitasTentativas, texto } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { ehPapelApp } from "@/app-movel/permissoes";
import { exigirVersaoMinima } from "@/app-movel/versao";
import { confirmarDesafio, lembrarDispositivo, lerDesafio, mfaAtivoNoApp, validadeSemConfianca } from "@/auth/mfa";
import { db } from "@/db";
import { usuario as usuarioTable } from "@/db/schema";
import { registrarSeguranca } from "@/sistema/seguranca";

export const dynamic = "force-dynamic";

/**
 * Segunda etapa do login do app: o código do aplicativo autenticador.
 *
 *   POST { desafio, codigo, confiar? }
 *
 * `desafio` é o token que `POST /sessao` devolveu em `mfa_necessaria`. Com
 * `confiar: true` a resposta traz `dispositivoToken`, que o app guarda (no
 * cofre, junto da sessão) e manda de volta nos próximos logins: por 30 dias o
 * código não é pedido neste aparelho. Os freios são os do navegador.
 */
export async function POST(req: Request) {
  const velho = exigirVersaoMinima(req);
  if (velho) return velho;
  if (!mfaAtivoNoApp()) return falha(404, "nao_encontrado", "Nada aqui.");

  const ip = ipDe(req);
  const porIp = consumir(`mfa-ip:${ip}`, 40, 15 * MINUTO);
  if (!porIp.ok) {
    registrarSeguranca("mfa_bloqueado", { origem: "app", ip });
    return muitasTentativas(porIp.tenteEmSegundos);
  }

  const corpo = await lerJson(req);
  const token = texto(corpo?.desafio, 100);
  const codigo = texto(corpo?.codigo, 20);
  const confiar = corpo?.confiar === true;
  if (!token || !codigo) return falha(400, "validacao", "Falta o código.");

  const desafio = await lerDesafio(token, "app");
  if (!desafio) return falha(401, "mfa_expirou", "O código demorou demais ou errou vezes demais. Entre de novo com a senha.");

  const porPessoa = consumir(`mfa-pessoa:${desafio.usuarioId}`, 15, 15 * MINUTO);
  if (!porPessoa.ok) {
    registrarSeguranca("mfa_bloqueado", { origem: "app", ip, usuarioId: desafio.usuarioId });
    return muitasTentativas(porPessoa.tenteEmSegundos);
  }

  const r = await confirmarDesafio({ token, codigo, origem: "app" });
  if (!r.ok) {
    registrarSeguranca("mfa_falhou", { origem: "app", ip, usuarioId: desafio.usuarioId, detalhe: r.motivo });
    return r.motivo === "codigo"
      ? falha(400, "codigo_incorreto", "Esse código não confere. Confira o número no aplicativo e tente de novo.")
      : falha(401, "mfa_expirou", "O código demorou demais ou errou vezes demais. Entre de novo com a senha.");
  }
  registrarSeguranca(r.primeiroCadastro ? "mfa_cadastrado" : "mfa_ok", { origem: "app", ip, usuarioId: r.usuarioId });

  // Nos minutos entre a senha e o código a conta pode ter mudado: confere de novo.
  const u = await db.query.usuario.findFirst({
    where: and(eq(usuarioTable.id, r.usuarioId)),
    with: { empresa: { columns: { id: true, nome: true, ativa: true } } },
  });
  if (!u || !u.ativo || !u.aprovadoEm || !u.empresa.ativa || !u.cpf || !ehPapelApp(u.papel)) {
    return falha(403, "conta_desativada", "Sua conta não pode entrar agora. Fale com o administrador.");
  }

  const aparelho = confiar
    ? await lembrarDispositivo({ usuarioId: u.id, origem: "app", rotulo: r.dispositivo ?? "Celular" })
    : undefined;
  registrarSeguranca("login_ok", { origem: "app", ip, usuarioId: u.id, detalhe: confiar ? "confiou no aparelho" : "sem confiar" });
  return respostaDeEntrada(
    { ...u, papel: u.papel, cpf: u.cpf, empresa: u.empresa },
    r.dispositivo,
    aparelho?.expiraEm ?? validadeSemConfianca(),
    aparelho,
  );
}
