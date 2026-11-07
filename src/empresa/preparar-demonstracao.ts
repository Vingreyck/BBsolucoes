import "dotenv/config";

import { randomBytes } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { formatarCpf } from "@/auth/cpf";
import { gerarHash, gerarSenhaProvisoria } from "@/auth/senha";
import { db, schema } from "@/db";
import type { Ator } from "@/os/acesso";
import { criarOs } from "@/os/fluxo";
import { relogioAgora } from "@/os/relogio";
import type { PrioridadeOs, TipoOs } from "@/os/tipos";

import { hashDoCodigo } from "./codigo-acesso";

/**
 * A conta que os revisores da App Store e da Google Play usam no app.
 *
 *   npm run demo:revisao
 *
 * Empresa própria, separada da BB: um técnico, dois clientes inventados e três
 * OS (hoje, amanhã e uma urgente sem data). Quem revisa não vê nada de cliente
 * real. Cada execução sorteia código da empresa e senha novos — impressos uma
 * vez, sem ficar em arquivo, porque o repositório é público — e repõe as OS
 * que o revisor concluiu. A Apple testa "Excluir conta": rode de novo antes de
 * cada envio para revisão.
 */

const EMPRESA = "Demonstração BBSolution";
/** 000.000.001-91: passa no cálculo e é conhecido como CPF de teste — não é de ninguém. */
const CPF = "00000000191";
const ABERTAS = ["aberta", "agendada", "em_deslocamento", "em_andamento", "aguardando_peca"] as const;

const CLIENTES = [
  {
    nome: "Maria Exemplo da Silva",
    tipo: "pf" as const,
    logradouro: "Avenida Beira Mar",
    numero: "1000",
    bairro: "Treze de Julho",
    cidade: "Aracaju",
    uf: "SE",
    cep: "49020010",
  },
  {
    nome: "Padaria Sol Nascente (exemplo)",
    tipo: "pj" as const,
    logradouro: "Rua de Itabaiana",
    numero: "250",
    bairro: "Centro",
    cidade: "Aracaju",
    uf: "SE",
    cep: "49010170",
  },
];

interface OsDeExemplo {
  tipo: TipoOs;
  prioridade: PrioridadeOs;
  cliente: number;
  descricao: string;
  quando: "hoje" | "amanha" | null;
}

const ORDENS: OsDeExemplo[] = [
  {
    tipo: "vistoria",
    prioridade: "normal",
    cliente: 0,
    quando: "hoje",
    descricao: "Vistoria para sistema de 6 kWp no telhado da casa. Conferir padrão de entrada e sombreamento.",
  },
  {
    tipo: "instalacao",
    prioridade: "alta",
    cliente: 1,
    quando: "amanha",
    descricao: "Instalação de 12 módulos de 550 W e inversor de 6 kW. Material já separado no estoque.",
  },
  {
    tipo: "corretiva",
    prioridade: "urgente",
    cliente: 0,
    quando: null,
    descricao: "Usina sem gerar há 2 dias. Conferir inversor, disjuntores e conexão com a internet.",
  },
];

async function main() {
  const codigo = `demo-${randomBytes(4).toString("hex")}`;
  let empresaId = (await db.query.empresa.findFirst({ where: eq(schema.empresa.nome, EMPRESA), columns: { id: true } }))?.id;
  if (empresaId) {
    await db.update(schema.empresa).set({ codigoAcessoHash: hashDoCodigo(codigo), ativa: true }).where(eq(schema.empresa.id, empresaId));
  } else {
    [{ id: empresaId }] = await db
      .insert(schema.empresa)
      .values({ nome: EMPRESA, codigoAcessoHash: hashDoCodigo(codigo) })
      .returning({ id: schema.empresa.id });
  }

  const senha = gerarSenhaProvisoria();
  const senhaHash = await gerarHash(senha);
  const ja = await db.query.usuario.findFirst({
    where: and(eq(schema.usuario.empresaId, empresaId), eq(schema.usuario.cpf, CPF)),
    columns: { id: true },
  });
  const revisorId = ja
    ? (
        await db
          .update(schema.usuario)
          .set({ senhaHash, ativo: true, papel: "tecnico", deveTrocarSenha: false, aprovadoEm: new Date() })
          .where(eq(schema.usuario.id, ja.id))
          .returning({ id: schema.usuario.id })
      )[0].id
    : (
        await db
          .insert(schema.usuario)
          .values({ empresaId, nome: "Revisor das Lojas", cpf: CPF, senhaHash, papel: "tecnico", ativo: true, aprovadoEm: new Date() })
          .returning({ id: schema.usuario.id })
      )[0].id;
  // Quem entrou com a senha antiga sai: a senha nova vale sozinha.
  await db.delete(schema.sessao).where(eq(schema.sessao.usuarioId, revisorId));

  const clienteIds: string[] = [];
  for (const c of CLIENTES) {
    const existente = await db.query.cliente.findFirst({
      where: and(eq(schema.cliente.empresaId, empresaId), eq(schema.cliente.nome, c.nome)),
      columns: { id: true },
    });
    clienteIds.push(
      existente?.id ??
        (await db.insert(schema.cliente).values({ empresaId, ...c }).returning({ id: schema.cliente.id }))[0].id,
    );
  }

  const abertas = await db
    .select({ tipo: schema.ordemServico.tipo })
    .from(schema.ordemServico)
    .where(
      and(
        eq(schema.ordemServico.empresaId, empresaId),
        eq(schema.ordemServico.responsavelId, revisorId),
        inArray(schema.ordemServico.status, [...ABERTAS]),
      ),
    );
  const sistema: Ator = { id: "", nome: "Demonstração", empresaId, papel: "sistema", origem: "sistema", gestao: true };
  const criadas: number[] = [];
  for (const o of ORDENS) {
    if (abertas.some((a) => a.tipo === o.tipo)) continue;
    const { numero } = await criarOs(sistema, {
      clienteId: clienteIds[o.cliente],
      tipo: o.tipo,
      prioridade: o.prioridade,
      descricao: o.descricao,
      responsavelId: revisorId,
      agendadaPara: o.quando ? horario(o.quando) : null,
    });
    criadas.push(numero);
  }

  console.log("");
  console.log(`Conta dos revisores — ${EMPRESA}`);
  console.log(`  Código da empresa: ${codigo}`);
  console.log(`  CPF:               ${formatarCpf(CPF)}`);
  console.log(`  Senha:             ${senha}`);
  console.log(`  OS novas: ${criadas.length ? criadas.map((n) => `#${String(n).padStart(4, "0")}`).join(", ") : "nenhuma (as três seguem abertas)"}`);
  console.log("");
  console.log("Nada disso fica salvo: copie agora para o App Store Connect e o Play Console.");
  process.exit(0);
}

/** Hoje daqui a uma hora (hora cheia), ou amanhã às 9h — no relógio de Sergipe. */
function horario(quando: "hoje" | "amanha"): Date {
  const r = relogioAgora();
  if (quando === "hoje") {
    r.setUTCHours(r.getUTCHours() + 1, 0, 0, 0);
    return r;
  }
  r.setUTCDate(r.getUTCDate() + 1);
  r.setUTCHours(9, 0, 0, 0);
  return r;
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
