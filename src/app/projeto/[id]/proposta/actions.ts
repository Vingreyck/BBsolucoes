"use server";

import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, schema } from "@/db";
import type { TipoDeEquipamento } from "@/equipamentos/regras";
import { itemDaBase } from "@/equipamentos/base";
import { exigirGestaoWeb } from "@/os/acesso";
import { sincronizarDatasheets } from "@/projeto/datasheets";
import { calcularAssistente, consumoMedioTotal, lerEstado, type LinhaDoKit } from "@/proposta/assistente";
import {
  catalogoDaEmpresa,
  contextoDoAssistente,
  procurarEquipamentos,
  type ContextoMontado,
  type OpcaoDeEquipamento,
} from "@/proposta/assistente-servidor";
import { municipio, procurarMunicipios } from "@/proposta/municipios";
import { montarPropostaDoAssistente } from "@/proposta/proposta";
import { contextoDaProposta, premissasDaEmpresa, proximoNumeroDeProposta, responsaveisPossiveis, telefoneBonito } from "@/proposta/proposta-dados";

/**
 * As ações do assistente da proposta comercial (`/projeto/<id>/proposta`).
 * Todas conferem que quem chama é da gestão e que o projeto é da empresa dele;
 * o que vem do navegador passa por `lerEstado` antes de qualquer conta.
 */

async function projetoDaEmpresa(projetoId: string, empresaId: string) {
  return db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, empresaId)),
    with: { cliente: { columns: { id: true, nome: true, cidade: true, uf: true } } },
  });
}

/** Guarda o assistente pela metade: dá para fechar e continuar depois. */
export async function salvarRascunhoDaProposta(projetoId: string, bruto: unknown): Promise<{ ok: boolean }> {
  const ator = await exigirGestaoWeb();
  const estado = lerEstado(bruto);
  if (!estado) return { ok: false };
  await db
    .update(schema.projeto)
    .set({ propostaRascunho: estado })
    .where(and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, ator.empresaId)));
  return { ok: true };
}

/** Cidades para o campo de busca. */
export async function buscarCidades(texto: string): Promise<{ nome: string; uf: string }[]> {
  await exigirGestaoWeb();
  return procurarMunicipios(String(texto ?? "").slice(0, 60));
}

/** O sol e as distribuidoras de uma cidade (quando a cidade muda). */
export async function dadosDaCidade(cidade: string, uf: string) {
  await exigirGestaoWeb();
  const m = municipio(String(cidade ?? ""), String(uf ?? ""));
  return m
    ? { nome: m.nome, uf: m.uf, irradiacaoMensal: m.irradiacaoMensal, irradiacaoAnual: m.irradiacaoAnual, distribuidoras: m.distribuidoras.map((d) => ({ cnpj: d.cnpj, nome: d.nome, participacao: d.participacao })) }
    : null;
}

/**
 * O contexto da conta para o estado atual: sol da cidade, tarifas (do cache ou
 * da ANEEL) e distância. `buscar`: "cache" só lê o guardado; "buscar" vai à
 * ANEEL se venceu; "forcar" vai sempre (botão "Buscar de novo").
 */
export async function recalcularContexto(bruto: unknown, buscar: "cache" | "buscar" | "forcar"): Promise<ContextoMontado | null> {
  const ator = await exigirGestaoWeb();
  const estado = lerEstado(bruto);
  const premissas = await premissasDaEmpresa(ator.empresaId);
  if (!estado || !premissas) return null;
  return contextoDoAssistente(estado, premissas, buscar === "forcar" ? "forcar" : buscar === "buscar" ? "buscar" : "cache");
}

const TIPOS: TipoDeEquipamento[] = ["modulo", "inversor", "microinversor"];

/** Busca de equipamento: o catálogo da empresa primeiro, depois a base da ANEEL. */
export async function buscarEquipamentos(texto: string, tipos: TipoDeEquipamento[]): Promise<OpcaoDeEquipamento[]> {
  const ator = await exigirGestaoWeb();
  const validos = (Array.isArray(tipos) ? tipos : []).filter((t) => TIPOS.includes(t));
  if (!validos.length) return [];
  const catalogo = await catalogoDaEmpresa(ator.empresaId);
  return procurarEquipamentos(catalogo, String(texto ?? "").slice(0, 80), validos, 40);
}

/**
 * O modelo do catálogo para a linha do kit: o que ela já aponta, o que veio da
 * mesma linha da base (criado agora, com os dados técnicos), ou nenhum (linha
 * digitada à mão, sem base nem catálogo).
 */
async function garantirNoCatalogo(empresaId: string, l: LinhaDoKit): Promise<string | null> {
  if (l.modeloId) {
    const [existe] = await db
      .select({ id: schema.modeloEquipamento.id, precoCusto: schema.modeloEquipamento.precoCusto })
      .from(schema.modeloEquipamento)
      .where(and(eq(schema.modeloEquipamento.id, l.modeloId), eq(schema.modeloEquipamento.empresaId, empresaId)));
    if (existe) {
      // O preço digitado no assistente vira o preço de custo do catálogo, se ele não tinha.
      if (existe.precoCusto === null && l.precoUnitario !== null) {
        await db.update(schema.modeloEquipamento).set({ precoCusto: String(l.precoUnitario) }).where(eq(schema.modeloEquipamento.id, existe.id));
      }
      return existe.id;
    }
  }
  if (!l.baseId) {
    // Digitado à mão: reaproveita o mesmo modelo do catálogo, ou cadastra.
    const iguais = await db
      .select({ id: schema.modeloEquipamento.id, fabricante: schema.modeloEquipamento.fabricante, modelo: schema.modeloEquipamento.modelo })
      .from(schema.modeloEquipamento)
      .where(and(eq(schema.modeloEquipamento.empresaId, empresaId), eq(schema.modeloEquipamento.tipo, l.tipo)));
    const k = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
    const igual = iguais.find((m) => k(m.modelo) === k(l.modelo) && k(m.fabricante) === k(l.fabricante));
    if (igual) return igual.id;
    const [manual] = await db
      .insert(schema.modeloEquipamento)
      .values({
        empresaId,
        tipo: l.tipo,
        fabricante: l.fabricante.slice(0, 80) || "—",
        modelo: l.modelo.slice(0, 120),
        potenciaW: String(l.potenciaW),
        precoCusto: l.precoUnitario === null ? null : String(l.precoUnitario),
        especificacoes: { fases: l.fases ?? null, modulosPorUnidade: l.modulosPorUnidade ?? null, areaM2: l.areaM2 ?? null },
      })
      .returning({ id: schema.modeloEquipamento.id });
    return manual?.id ?? null;
  }
  const [ja] = await db
    .select({ id: schema.modeloEquipamento.id })
    .from(schema.modeloEquipamento)
    .where(and(eq(schema.modeloEquipamento.empresaId, empresaId), eq(schema.modeloEquipamento.baseId, l.baseId)));
  if (ja) return ja.id;
  const base = itemDaBase(l.baseId);
  const [novo] = await db
    .insert(schema.modeloEquipamento)
    .values({
      empresaId,
      tipo: l.tipo,
      fabricante: (base?.fabricante ?? l.fabricante).slice(0, 80),
      modelo: (base?.modelo ?? l.modelo).slice(0, 120),
      potenciaW: String(base?.potenciaW ?? l.potenciaW),
      baseId: l.baseId,
      precoCusto: l.precoUnitario === null ? null : String(l.precoUnitario),
      especificacoes: {
        fases: base?.fases ?? l.fases ?? null,
        modulosPorUnidade: base?.modulosPorUnidade ?? l.modulosPorUnidade ?? null,
        areaM2: base?.eletrico?.areaM2 ?? l.areaM2 ?? null,
        ...(base?.eletrico ? { eletrico: base.eletrico } : {}),
      },
    })
    .returning({ id: schema.modeloEquipamento.id });
  return novo?.id ?? null;
}

/**
 * Gera a proposta do assistente: refaz a conta no servidor (com a tarifa da
 * ANEEL buscada agora, se venceu), confere o que falta, põe os equipamentos no
 * catálogo da empresa, grava a proposta numerada e leva os números para o
 * projeto (valor, potência, consumo, ligação, distribuidora, telhado, kit) —
 * o contrato e o dossiê continuam lendo de lá.
 */
export async function gerarPropostaDoAssistente(projetoId: string, origem: string, bruto: unknown): Promise<{ erro: string } | void> {
  const ator = await exigirGestaoWeb();
  const projeto = await projetoDaEmpresa(projetoId, ator.empresaId);
  if (!projeto) return { erro: "Projeto não encontrado." };
  const estado = lerEstado(bruto);
  if (!estado) return { erro: "Os dados da proposta vieram quebrados. Recarregue a página." };
  const premissas = await premissasDaEmpresa(ator.empresaId);
  if (!premissas) return { erro: "Faltam as premissas da proposta (Administração → Proposta comercial)." };

  const montado = await contextoDoAssistente(estado, premissas, "buscar");
  const r = calcularAssistente(estado, montado.ctx);
  if (r.falta.length) return { erro: `Ainda falta: ${r.falta.join(", ")}.` };

  const responsaveis = await responsaveisPossiveis(ator.empresaId);
  const responsavel = responsaveis.find((x) => x.id === estado.responsavelId) ?? responsaveis.find((x) => x.id === ator.id) ?? responsaveis[0];
  if (!responsavel) return { erro: "Ninguém ativo (adm ou vendedor) para assinar a proposta como responsável." };

  // Os equipamentos entram no catálogo da empresa (é de lá que o dossiê puxa o datasheet).
  const moduloId = estado.modulo ? await garantirNoCatalogo(ator.empresaId, estado.modulo) : null;
  const inversores = estado.inversores.filter((i) => i.qtd > 0);
  const inversorId = inversores[0] ? await garantirNoCatalogo(ator.empresaId, inversores[0]) : null;
  for (const outro of inversores.slice(1)) await garantirNoCatalogo(ator.empresaId, outro);

  const ctx = await contextoDaProposta(ator.empresaId, { nome: responsavel.nome, telefone: responsavel.telefone });
  const geradora = estado.ucs.find((u) => u.geradora) ?? estado.ucs[0];
  let numero = 0;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    numero = await proximoNumeroDeProposta(ator.empresaId, premissas.numeroInicial);
    const dados = montarPropostaDoAssistente(estado, r, {
      numero,
      empresa: ctx.empresa,
      cliente: { nome: projeto.cliente.nome },
      responsavel: { nome: responsavel.nome, contato: telefoneBonito(responsavel.telefone) },
      premissas,
      fonteIrradiacao: estado.irradiacaoManual ? "irradiação informada na proposta" : montado.fonteIrradiacao,
      fontesDeTarifa: estado.ucs.map((u) => u.distribuidoraNome || null),
    });
    try {
      await db.insert(schema.proposta).values({
        empresaId: ator.empresaId,
        projetoId: projeto.id,
        numero,
        token: randomBytes(24).toString("base64url"),
        dados,
        criadoPorId: ator.id,
      });
      break;
    } catch (e) {
      if ((e as { code?: string })?.code !== "23505" || tentativa === 2) throw e;
    }
  }

  const consumo = consumoMedioTotal(r);
  await db
    .update(schema.projeto)
    .set({
      valor: r.precoFinal!.toFixed(2),
      potenciaKwp: r.kwp.toFixed(3),
      ...(consumo ? { consumoMedioKwh: consumo.toFixed(2) } : {}),
      ligacao: geradora.ligacao,
      ...(geradora.distribuidoraNome ? { concessionaria: geradora.distribuidoraNome } : {}),
      ...(estado.telhado && !projeto.telhadoTipo ? { telhadoTipo: estado.telhado } : {}),
      moduloModeloId: moduloId,
      moduloQtd: estado.modulo?.qtd ?? null,
      inversorModeloId: inversorId,
      inversorQtd: inversores[0]?.qtd ?? null,
      propostaRascunho: estado,
      atualizadoEm: new Date(),
    })
    .where(eq(schema.projeto.id, projeto.id));

  // O kit mudou: o dossiê recebe o datasheet e o Inmetro dos modelos (os que já têm o PDF).
  try {
    await sincronizarDatasheets(ator.empresaId, projeto.id, ator.id);
  } catch {
    // Sem Drive ou sem PDF: a proposta já saiu; o dossiê acerta na próxima vez que o kit for salvo.
  }

  // O número de cada unidade vira unidade consumidora do cliente (se ainda não existe).
  for (const u of estado.ucs) {
    const codigo = u.codigo.replace(/\s/g, "");
    if (!/^\d{4,20}$/.test(codigo)) continue;
    await db
      .insert(schema.unidadeConsumidora)
      .values({
        empresaId: ator.empresaId,
        clienteId: projeto.cliente.id,
        numeroInstalacao: codigo,
        concessionaria: u.distribuidoraNome || "Energisa Sergipe",
        titular: projeto.cliente.nome,
        classe: u.subgrupo === "B1" ? "Residencial" : u.subgrupo === "B2" ? "Rural" : "Comercial",
      })
      .onConflictDoNothing();
  }

  revalidatePath("/esteira");
  revalidatePath(`/projeto/${projeto.id}`);
  const para = origem === "esteira" ? "/esteira" : `/projeto/${projeto.id}`;
  const q = new URLSearchParams({
    ok: `Proposta ${numero} de ${projeto.cliente.nome} gerada. Agora é enviar pelo WhatsApp; o cartão mostra quando o cliente abrir.`,
  });
  redirect(`${para}?${q}`);
}

/** Recomeça o assistente do zero (apaga o rascunho; as propostas geradas ficam). */
export async function recomecarProposta(projetoId: string): Promise<void> {
  const ator = await exigirGestaoWeb();
  await db
    .update(schema.projeto)
    .set({ propostaRascunho: null })
    .where(and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, ator.empresaId)));
  revalidatePath(`/projeto/${projetoId}/proposta`);
  redirect(`/projeto/${projetoId}/proposta`);
}

