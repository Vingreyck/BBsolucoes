"use server";

import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import {
  cliente as clienteTable,
  contaPortal as contaPortalTable,
  equipamento as equipamentoTable,
  etapa as etapaTable,
  projeto as projetoTable,
  usina as usinaTable,
  vinculoPortal as vinculoTable,
} from "@/db/schema";

import { TOTAL_PASSOS } from "./passos";

type Fabricante =
  | "growatt"
  | "hoymiles"
  | "solis"
  | "foxess"
  | "huawei"
  | "solarportal_plus"
  | "nep"
  | "outro";

const texto = (d: FormData, campo: string) => {
  const v = String(d.get(campo) ?? "").trim();
  return v === "" ? null : v;
};

const numero = (d: FormData, campo: string) => {
  const v = texto(d, campo);
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Passo 1: cria cliente, usina, vínculo com o portal e o projeto na esteira.
 *
 * Só este passo cria — os outros quatro atualizam. Assim a ficha já existe no
 * banco a partir da primeira tela, e nada do que for digitado depois se perde
 * se o navegador fechar.
 */
export async function salvarPasso1(dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();

  const nomeCliente = texto(dados, "cliente");
  const nomeUsina = texto(dados, "usina") ?? nomeCliente;
  if (!nomeCliente || !nomeUsina) {
    redirect("/cadastro?erro=Informe%20o%20nome%20do%20cliente");
  }

  const fabricante = (texto(dados, "fabricante") ?? "outro") as Fabricante;
  const idExterno = texto(dados, "idExterno");

  const id = await db.transaction(async (tx) => {
    // Reaproveita o cliente quando o nome já existe: cadastrar a segunda usina
    // do mesmo cliente não pode criar um cliente duplicado.
    let cliente = await tx.query.cliente.findFirst({
      where: and(
        eq(clienteTable.empresaId, usuario.empresaId),
        eq(clienteTable.nome, nomeCliente),
      ),
    });
    if (!cliente) {
      [cliente] = await tx
        .insert(clienteTable)
        .values({
          empresaId: usuario.empresaId,
          nome: nomeCliente,
          telefone: texto(dados, "telefone"),
          cidade: texto(dados, "cidade"),
          uf: texto(dados, "uf"),
        })
        .returning();
    }

    const potencia = numero(dados, "potenciaKwp");
    const [usina] = await tx
      .insert(usinaTable)
      .values({
        empresaId: usuario.empresaId,
        clienteId: cliente.id,
        nome: nomeUsina,
        cidade: texto(dados, "cidade"),
        uf: texto(dados, "uf"),
        potenciaKwp: potencia !== null ? String(potencia) : null,
        status: "em_implantacao",
        cadastroPasso: 1,
      })
      .returning();

    // Vínculo com o portal só faz sentido se houver identificação lá.
    if (idExterno) {
      let conta = await tx.query.contaPortal.findFirst({
        where: and(
          eq(contaPortalTable.empresaId, usuario.empresaId),
          eq(contaPortalTable.fabricante, fabricante),
        ),
      });
      if (!conta) {
        [conta] = await tx
          .insert(contaPortalTable)
          .values({
            empresaId: usuario.empresaId,
            fabricante,
            apelido: `Portal ${fabricante}`,
          })
          .returning();
      }
      await tx
        .insert(vinculoTable)
        .values({
          empresaId: usuario.empresaId,
          usinaId: usina.id,
          contaPortalId: conta.id,
          idExterno,
          nomeExterno: nomeUsina,
        })
        .onConflictDoNothing();
    }

    // O projeto entra na esteira já na coleta de informações.
    const etapa = await tx.query.etapa.findFirst({
      where: and(
        eq(etapaTable.empresaId, usuario.empresaId),
        eq(etapaTable.slug, "coleta_info"),
      ),
    });
    const primeira =
      etapa ??
      (await tx.query.etapa.findFirst({
        where: eq(etapaTable.empresaId, usuario.empresaId),
        orderBy: asc(etapaTable.ordem),
      }));

    if (primeira) {
      await tx.insert(projetoTable).values({
        empresaId: usuario.empresaId,
        clienteId: cliente.id,
        usinaId: usina.id,
        etapaId: primeira.id,
        titulo: nomeUsina,
        potenciaKwp: potencia !== null ? String(potencia) : null,
        responsavelId: usuario.id,
      });
    }

    return usina.id;
  });

  redirect(`/cadastro/${id}/2`);
}

export async function salvarPasso2(usinaId: string, dados: FormData): Promise<void> {
  await exigirUsuario();
  await db
    .update(usinaTable)
    .set({
      observacoesVistoria: texto(dados, "observacoes"),
      linkDrive: texto(dados, "linkDrive"),
      cadastroPasso: 2,
    })
    .where(eq(usinaTable.id, usinaId));
  redirect(`/cadastro/${usinaId}/3`);
}

/** Passo 3: o inversor e, se houver, o datalogger que o acompanha. */
export async function salvarPasso3(usinaId: string, dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();

  const serie = texto(dados, "numeroSerie");
  if (serie) {
    const potenciaW = numero(dados, "potenciaW");
    const jaTem = await db.query.equipamento.findFirst({
      where: eq(equipamentoTable.numeroSerie, serie),
    });
    if (!jaTem) {
      await db.insert(equipamentoTable).values({
        empresaId: usuario.empresaId,
        usinaId,
        tipo: (texto(dados, "tipo") ?? "inversor") as "inversor" | "microinversor",
        fabricante: texto(dados, "fabricante"),
        modelo: texto(dados, "modelo"),
        numeroSerie: serie,
        potenciaW: potenciaW !== null ? String(potenciaW) : null,
      });
    }
  }

  const datalogger = texto(dados, "datalogger");
  if (datalogger) {
    const jaTem = await db.query.equipamento.findFirst({
      where: eq(equipamentoTable.numeroSerie, datalogger),
    });
    if (!jaTem) {
      await db.insert(equipamentoTable).values({
        empresaId: usuario.empresaId,
        usinaId,
        tipo: "datalogger",
        fabricante: texto(dados, "fabricante"),
        numeroSerie: datalogger,
      });
    }
  }

  await db
    .update(usinaTable)
    .set({ cadastroPasso: 3 })
    .where(eq(usinaTable.id, usinaId));
  redirect(`/cadastro/${usinaId}/4`);
}

/**
 * Passo 4: os módulos que saíram da prateleira.
 *
 * Registrados como um equipamento com quantidade, e não um por número de série:
 * ninguém anota a série de vinte painéis. O que a empresa precisa saber é
 * quantos, de qual marca e de qual potência foram para cada obra — que é
 * exatamente o que a Conta Azul, controlando só quantidade, não responde.
 */
export async function salvarPasso4(usinaId: string, dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();

  const quantidade = numero(dados, "quantidade");
  const marca = texto(dados, "marcaModulo");
  if (quantidade && marca) {
    const potenciaW = numero(dados, "potenciaModulo");
    await db.insert(equipamentoTable).values({
      empresaId: usuario.empresaId,
      usinaId,
      tipo: "modulo",
      fabricante: marca,
      modelo: texto(dados, "modeloModulo"),
      quantidade: Math.round(quantidade),
      potenciaW: potenciaW !== null ? String(potenciaW) : null,
    });
  }

  await db
    .update(usinaTable)
    .set({ cadastroPasso: 4 })
    .where(eq(usinaTable.id, usinaId));
  redirect(`/cadastro/${usinaId}/5`);
}

/** Passo 5: fecha a ficha. O contrato fica no projeto, não na usina. */
export async function salvarPasso5(usinaId: string, dados: FormData): Promise<void> {
  await exigirUsuario();

  const valor = numero(dados, "valor");
  const projeto = await db.query.projeto.findFirst({
    where: eq(projetoTable.usinaId, usinaId),
  });

  if (projeto) {
    await db
      .update(projetoTable)
      .set({
        valor: valor !== null ? String(valor) : null,
        numeroArt: texto(dados, "numeroArt"),
      })
      .where(eq(projetoTable.id, projeto.id));
  }

  await db
    .update(usinaTable)
    .set({
      linkDrive: texto(dados, "linkDrive"),
      cadastroPasso: TOTAL_PASSOS,
    })
    .where(eq(usinaTable.id, usinaId));

  redirect(`/usinas?busca=${encodeURIComponent(texto(dados, "nomeUsina") ?? "")}`);
}
