"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { confirmarDesafio, lembrarDispositivo, lerDesafio, rotuloDoDispositivo, validadeSemConfianca } from "@/auth/mfa";
import { desafioGuardado, dispositivoGuardado, esquecerDesafio, guardarDispositivo } from "@/auth/mfa-web";
import { criarSessao } from "@/auth/sessao";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { registrarSeguranca } from "@/sistema/seguranca";

async function ipAtual(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? "local";
}

/**
 * O código do aplicativo autenticador, depois da senha.
 *
 * Sem JavaScript, como o login: o erro volta por redirecionamento.
 *
 * Três freios, do mais largo ao mais estreito: por IP, por pessoa (15 códigos
 * em 15 minutos, não importa quantas vezes ela acerte a senha de novo) e por
 * desafio (5 tentativas, no banco — `confirmarDesafio`).
 */
export async function confirmarCodigo(dados: FormData): Promise<void> {
  const codigo = String(dados.get("codigo") ?? "").slice(0, 20);
  const confiar = dados.get("confiar") === "sim";
  const ip = await ipAtual();

  const desafio = await lerDesafio(await desafioGuardado(), "web");
  if (!desafio) {
    await esquecerDesafio();
    redirect("/login?erro=mfa_expirou");
  }

  const porIp = consumir(`mfa-ip:${ip}`, 40, 15 * MINUTO);
  const porPessoa = consumir(`mfa-pessoa:${desafio.usuarioId}`, 15, 15 * MINUTO);
  if (!porIp.ok || !porPessoa.ok) {
    registrarSeguranca("mfa_bloqueado", { origem: "web", ip, usuarioId: desafio.usuarioId });
    redirect("/login/mfa?erro=tentativas");
  }

  const token = (await desafioGuardado()) ?? "";
  const r = await confirmarDesafio({ token, codigo, origem: "web" });
  if (!r.ok) {
    registrarSeguranca("mfa_falhou", { origem: "web", ip, usuarioId: desafio.usuarioId, detalhe: r.motivo });
    if (r.motivo === "codigo") redirect("/login/mfa?erro=codigo");
    await esquecerDesafio();
    redirect("/login?erro=mfa_expirou");
  }

  await esquecerDesafio();
  registrarSeguranca(r.primeiroCadastro ? "mfa_cadastrado" : "mfa_ok", { origem: "web", ip, usuarioId: r.usuarioId });

  /**
   * "Confiar neste aparelho": o código só volta a ser pedido daqui a 30 dias.
   * Sem marcar, a sessão dura 12 horas e o código é pedido no próximo login.
   * Num aparelho que já era conhecido (30 dias vencidos), o cookie antigo é
   * substituído, não acumulado.
   */
  let validaAte: Date;
  if (confiar) {
    const agente = (await headers()).get("user-agent");
    const novo = await lembrarDispositivo({
      usuarioId: r.usuarioId,
      origem: "web",
      rotulo: rotuloDoDispositivo(agente),
      tokenAnterior: await dispositivoGuardado(r.usuarioId),
    });
    await guardarDispositivo(r.usuarioId, novo.token, novo.expiraEm);
    validaAte = novo.expiraEm;
  } else {
    validaAte = validadeSemConfianca();
  }

  await criarSessao(r.usuarioId, { mfaValidaAte: validaAte });
  registrarSeguranca("login_ok", { origem: "web", ip, usuarioId: r.usuarioId, detalhe: confiar ? "confiou no aparelho" : "sem confiar" });
  redirect("/");
}

/** "Voltar": desiste do desafio e recomeça pela senha. */
export async function cancelarCodigo(): Promise<void> {
  await esquecerDesafio();
  redirect("/login");
}
