import "dotenv/config";

import { and, eq, inArray, sql } from "drizzle-orm";

import { ordemDoUsuario } from "@/app-movel/ordens";
import type { UsuarioApp } from "@/auth/sessao-app";
import { db, schema } from "@/db";
import { ErroOs, type Ator } from "@/os/acesso";
import { criarOs, executarAcao } from "@/os/fluxo";
import { garantirModelos } from "@/os/modelos";

import { corrigirMaterial, registrarMaterial, removerMaterial } from "./baixa";
import { ajustarSaldo, desfazerEntrada, ErroEstoque, lancarAMao, lancarEntrada, movimentos } from "./estoque";
import { lerDocumentoDeEntrada } from "./ler-documento";
import { CHAVE, XML_KIT } from "./testar-estoque";

/**
 * O estoque contra o banco de verdade, sem site nem app:
 *
 *   npm run testar:estoque
 *
 * Cria uma empresa de teste só dela (com técnico, cliente e OS), lança uma
 * entrada à mão e a nota do kit em XML, registra material na OS pelo "app",
 * corrige, tira, cancela, reabre, desfaz a entrada e ajusta a contagem —
 * conferindo o saldo a cada passo. Apaga tudo no fim, dê certo ou errado. Não
 * toca o Drive nem a Groq (o XML é lido sem IA).
 */

let falhas = 0;
let total = 0;
function confere(condicao: unknown, descricao: string, detalhe?: unknown) {
  total++;
  if (condicao) console.log(`  ok  ${descricao}`);
  else {
    falhas++;
    console.log(`  FALHOU  ${descricao}`, detalhe ?? "");
  }
}

async function recusa(promessa: Promise<unknown>, descricao: string, codigo?: string) {
  try {
    await promessa;
    confere(false, descricao, "(passou, devia ter recusado)");
  } catch (e) {
    const ok = codigo ? e instanceof ErroOs && e.codigo === codigo : e instanceof ErroEstoque;
    confere(ok, descricao, e instanceof Error ? e.message : e);
  }
}

async function saldo(itemId: string): Promise<number> {
  const [l] = await db
    .select({ s: sql<string>`coalesce(sum(${schema.movimentoEstoque.quantidade}), 0)` })
    .from(schema.movimentoEstoque)
    .where(eq(schema.movimentoEstoque.itemId, itemId));
  return Number(l.s);
}

async function itemPeloNome(empresaId: string, trecho: string) {
  const itens = await db.query.itemEstoque.findMany({ where: eq(schema.itemEstoque.empresaId, empresaId) });
  return itens.find((i) => i.nome.toUpperCase().includes(trecho.toUpperCase()));
}

async function main() {
  const marca = `teste-estoque-${Date.now()}`;
  const [empresa] = await db
    .insert(schema.empresa)
    .values({ nome: `Empresa teste do estoque (pode apagar) ${marca}` })
    .returning({ id: schema.empresa.id });

  try {
    const [adm, tecnico, outro] = await db
      .insert(schema.usuario)
      .values(
        ["adm", "tecnico", "tecnico"].map((papel, i) => ({
          empresaId: empresa.id,
          nome: `Teste estoque ${papel} ${i}`,
          email: `${marca}-${i}@teste.invalid`,
          cpf: String(90000000000 + i),
          senhaHash: "x",
          papel: papel as "adm" | "tecnico",
          ativo: true,
          aprovadoEm: new Date(),
        })),
      )
      .returning({ id: schema.usuario.id, nome: schema.usuario.nome });
    const gestao: Ator = { id: adm.id, nome: adm.nome, empresaId: empresa.id, papel: "adm", origem: "web", gestao: true };
    const tec: Ator = { id: tecnico.id, nome: tecnico.nome, empresaId: empresa.id, papel: "tecnico", origem: "app", gestao: false };
    const intruso: Ator = { ...tec, id: outro.id, nome: outro.nome };
    const quem = { id: adm.id, empresaId: empresa.id };

    const [cliente] = await db
      .insert(schema.cliente)
      .values({ empresaId: empresa.id, tipo: "pf", nome: "Cliente teste do estoque", cidade: "Aracaju", uf: "SE" })
      .returning({ id: schema.cliente.id });
    await garantirModelos(empresa.id);

    // ------------------------------------------------------------ entrada à mão
    console.log("\nEntrada à mão");
    const mao = await lancarAMao(quem, { numero: null, fornecedor: "Balcão", emitidaEm: null }, [
      { nome: "Módulo JA Solar 550W", quantidade: "20", unidade: "un" },
      { nome: "Cabo solar 6mm preto", quantidade: "100,5", unidade: "m" },
      { nome: "  ", quantidade: "3", unidade: "un" },
    ]);
    confere(mao.itens === 2, "duas linhas com nome entram (a vazia é ignorada)", mao);
    const modulo = await itemPeloNome(empresa.id, "550W");
    const cabo = await itemPeloNome(empresa.id, "CABO SOLAR 6MM PRETO");
    confere(modulo && (await saldo(modulo.id)) === 20, "módulo com saldo 20");
    confere(cabo && (await saldo(cabo.id)) === 100.5 && cabo.unidade === "m", "cabo com 100,5 m");
    await recusa(lancarAMao(quem, { numero: null, fornecedor: null, emitidaEm: null }, [{ nome: "Parafuso", quantidade: "0", unidade: "un" }]), "quantidade zero é recusada");
    const sobras = await db.query.entradaEstoque.findMany({ where: eq(schema.entradaEstoque.empresaId, empresa.id) });
    confere(sobras.length === 1, "a entrada recusada não deixa ficha vazia para trás", sobras.length);

    await lancarAMao(quem, { numero: null, fornecedor: null, emitidaEm: null }, [{ nome: "MODULO JA SOLAR 550 W", quantidade: 1, unidade: "un" }]);
    const mesmo = await db.query.itemEstoque.findMany({ where: eq(schema.itemEstoque.empresaId, empresa.id) });
    confere(mesmo.length === 2 && modulo && (await saldo(modulo.id)) === 21, "“550 W” e “550W” são o mesmo item: soma, não duplica", mesmo.map((i) => i.nome));
    await lancarAMao(quem, { numero: null, fornecedor: null, emitidaEm: null }, [{ nome: "módulo ja solar 550w", quantidade: 1, unidade: "un" }]);
    confere(modulo && (await saldo(modulo.id)) === 22, "mesmo nome em outra caixa soma no mesmo item");

    // ------------------------------------------------------------ nota do kit (XML)
    console.log("\nNota do kit em XML");
    const lida = await lerDocumentoDeEntrada(new TextEncoder().encode(XML_KIT), "application/xml", "nota");
    confere("lido" in lida, "o XML é lido sem a Groq");
    if (!("lido" in lida)) throw new Error("XML não leu");
    const [rascunho] = await db
      .insert(schema.entradaEstoque)
      .values({ empresaId: empresa.id, leitura: "xml", chaveAcesso: lida.lido.chaveAcesso, numero: lida.lido.numero, itensLidos: lida.lido.linhas, criadoPor: adm.id })
      .returning({ id: schema.entradaEstoque.id });
    const conferidas = lida.lido.linhas.map((l) => ({ ...l, itemId: l.descricao.includes("JA SOLAR") ? modulo!.id : null }));
    const r = await lancarEntrada(quem, rascunho.id, { numero: lida.lido.numero, fornecedor: lida.lido.fornecedor, emitidaEm: lida.lido.emitidaEm }, conferidas);
    confere(r.itens === 6, "seis componentes entram; o kit fica fora", r.itens);
    confere(modulo && (await saldo(modulo.id)) === 32, "os 10 módulos da observação somam no item que já existia (22 + 10)");
    confere(!(await itemPeloNome(empresa.id, "KIT GERADOR")), "o kit não virou item do estoque");
    const inversor = await itemPeloNome(empresa.id, "MIN 5000TL-X");
    confere(inversor && (await saldo(inversor.id)) === 1, "inversor novo com saldo 1");
    await recusa(lancarEntrada(quem, rascunho.id, { numero: null, fornecedor: null, emitidaEm: null }, conferidas), "a mesma entrada não lança duas vezes");

    const [outraVez] = await db
      .insert(schema.entradaEstoque)
      .values({ empresaId: empresa.id, leitura: "xml", chaveAcesso: CHAVE, itensLidos: [], criadoPor: adm.id })
      .returning({ id: schema.entradaEstoque.id });
    await recusa(lancarEntrada(quem, outraVez.id, { numero: null, fornecedor: null, emitidaEm: null }, conferidas), "a mesma NF-e (mesma chave) não entra duas vezes");
    await db.delete(schema.entradaEstoque).where(eq(schema.entradaEstoque.id, outraVez.id));

    // ------------------------------------------------------------ baixa pela OS
    console.log("\nBaixa pela OS");
    const os = await criarOs(gestao, { clienteId: cliente.id, tipo: "instalacao", prioridade: "normal", descricao: "Instalação teste do estoque", responsavelId: tecnico.id });
    const idCliente = crypto.randomUUID();
    const m1 = await registrarMaterial(tec, os.id, { itemId: modulo!.id, quantidade: 8, idCliente });
    confere(!m1.repetida && (await saldo(modulo!.id)) === 24, "técnico registra 8 módulos pelo app: saldo 32 → 24");
    const m1b = await registrarMaterial(tec, os.id, { itemId: modulo!.id, quantidade: 8, idCliente });
    confere(m1b.repetida && m1b.id === m1.id && (await saldo(modulo!.id)) === 24, "reenvio com o mesmo idCliente não desconta de novo");
    await recusa(registrarMaterial(intruso, os.id, { itemId: modulo!.id, quantidade: 1 }), "técnico de fora não mexe na OS dos outros", "nao_encontrada");
    await recusa(registrarMaterial(tec, os.id, { itemId: modulo!.id, quantidade: "abc" }), "quantidade inválida é recusada", "validacao");

    await corrigirMaterial(tec, os.id, m1.id, { quantidade: "5" });
    confere((await saldo(modulo!.id)) === 27, "corrigiu 8 → 5: volta 3 (saldo 27)");
    await corrigirMaterial(tec, os.id, m1.id, { quantidade: 10 });
    confere((await saldo(modulo!.id)) === 22, "corrigiu 5 → 10: saem mais 5 (saldo 22)");
    confere((await saldo(cabo!.id)) === 140.5, "o cabo preto da nota (40 m) somou no item que já existia (100,5 + 40)");
    const m2 = await registrarMaterial(tec, os.id, { itemId: cabo!.id, quantidade: "12,5" });
    confere((await saldo(cabo!.id)) === 128, "12,5 m de cabo saem (140,5 → 128)");
    await removerMaterial(tec, os.id, m2.id);
    confere((await saldo(cabo!.id)) === 140.5, "tirou o cabo da OS: volta tudo");
    await registrarMaterial(tec, os.id, { itemId: cabo!.id, quantidade: 30 });

    const usuarioApp: UsuarioApp = { id: tecnico.id, nome: tecnico.nome, cpf: "90000000001", email: null, papel: "tecnico", empresaId: empresa.id, empresaNome: "teste", deveTrocarSenha: false, sessaoId: "x" };
    const ordemApp = await ordemDoUsuario(usuarioApp, os.id);
    confere(ordemApp?.materiais.length === 2 && ordemApp.materiais.some((x) => x.quantidade === 10 && x.nome.includes("550W")), "a OS do app traz os materiais", ordemApp?.materiais);

    console.log("\nCancelar e reabrir");
    const cancelada = await executarAcao(gestao, os.id, { tipo: "cancelar", motivo: "Cliente desistiu" });
    confere((await saldo(modulo!.id)) === 32 && (await saldo(cabo!.id)) === 140.5, "OS cancelada: tudo volta para o estoque");
    confere(cancelada.avisos.some((a) => a.includes("voltou para o estoque")), "e a tela avisa", cancelada.avisos);
    await recusa(registrarMaterial(tec, os.id, { itemId: modulo!.id, quantidade: 1 }), "OS cancelada não aceita material", "transicao_invalida");
    await executarAcao(gestao, os.id, { tipo: "reabrir", motivo: "Cliente voltou" });
    confere((await saldo(modulo!.id)) === 22 && (await saldo(cabo!.id)) === 110.5, "reabriu: o material sai de novo");
    await executarAcao(gestao, os.id, { tipo: "cancelar", motivo: "Duplicada" });
    await executarAcao(gestao, os.id, { tipo: "reabrir", motivo: "Engano" });
    confere((await saldo(modulo!.id)) === 22, "cancelar e reabrir de novo não dobra nada");

    console.log("\nOS concluída");
    await db.update(schema.ordemServico).set({ status: "concluida" }).where(eq(schema.ordemServico.id, os.id));
    await recusa(registrarMaterial(tec, os.id, { itemId: modulo!.id, quantidade: 1 }), "OS concluída: técnico não mexe mais", "transicao_invalida");
    await corrigirMaterial(gestao, os.id, m1.id, { quantidade: 9 });
    confere((await saldo(modulo!.id)) === 23, "a gestão corrige depois de concluída (10 → 9)");

    console.log("\nSaldo negativo, desfazer e ajuste");
    await registrarMaterial(gestao, os.id, { itemId: inversor!.id, quantidade: 3 });
    confere((await saldo(inversor!.id)) === -2, "material além do saldo é aceito e o saldo fica negativo (-2)");
    await desfazerEntrada(quem, rascunho.id);
    confere((await saldo(modulo!.id)) === 13 && (await saldo(inversor!.id)) === -3, "desfazer a nota tira o que ela somou (módulo 23 → 13, inversor -2 → -3)");
    await recusa(desfazerEntrada(quem, rascunho.id), "não desfaz duas vezes");
    const dif = await ajustarSaldo(quem, inversor!.id, 4, "Contagem");
    confere(dif === 7 && (await saldo(inversor!.id)) === 4, "contagem na prateleira: ajusta para 4 (+7)");
    confere((await ajustarSaldo(quem, inversor!.id, 4, "")) === 0, "contar o mesmo de novo não lança nada");

    const livro = await movimentos(empresa.id, { itemId: modulo!.id });
    const motivos = new Set(livro.map((x) => x.motivo));
    confere(["entrada", "os", "estorno"].every((m) => motivos.has(m)), "o histórico guarda entrada, saída e estorno", [...motivos]);
    confere(livro.some((x) => x.ordemServico?.id === os.id && x.origem === "app"), "a saída diz a OS e que veio do app");
  } finally {
    // Apaga na ordem das ligações: livro e material antes dos itens.
    await db.delete(schema.movimentoEstoque).where(eq(schema.movimentoEstoque.empresaId, empresa.id));
    await db.delete(schema.osMaterial).where(eq(schema.osMaterial.empresaId, empresa.id));
    await db.delete(schema.entradaEstoque).where(eq(schema.entradaEstoque.empresaId, empresa.id));
    await db.delete(schema.itemEstoque).where(eq(schema.itemEstoque.empresaId, empresa.id));
    const ordens = await db.query.ordemServico.findMany({ where: eq(schema.ordemServico.empresaId, empresa.id), columns: { id: true } });
    if (ordens.length) await db.delete(schema.ordemServico).where(inArray(schema.ordemServico.id, ordens.map((o) => o.id)));
    await db.delete(schema.empresa).where(and(eq(schema.empresa.id, empresa.id)));
    console.log("\nDados de teste apagados.");
  }
  console.log(falhas === 0 ? `\n✓ ${total} conferências, nenhuma falha.` : `\n✗ ${falhas} de ${total} falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
