/**
 * As regras do estoque sem banco: o XML da NF-e, os itens escritos na
 * observação (a nota da empresa vem com um item só e o resto no texto), a
 * junção sem contar o kit duas vezes, a sugestão de item e a baixa da OS.
 *
 * Roda dentro do `npm run testar:regras`. Notas inventadas: nenhum
 * fornecedor, CNPJ ou chave real.
 */

import { isDeepStrictEqual } from "node:util";

import {
  chaveDoNome,
  diferencaDaBaixa,
  ehXmlDeNota,
  itensDoTexto,
  juntarItensDaNota,
  lerXmlDaNota,
  marcarRepetidos,
  normalizarUnidade,
  numeroBr,
  quantidadeValida,
  saldoDe,
  situacaoDoSaldo,
  sugerirItem,
} from "./regras";

type Confere = (condicao: boolean, o_que: string) => void;
type Igual = <T>(obtido: T, esperado: T, o_que: string) => void;

export const CHAVE = "28261100000000000191550010000012341000012345";

/** Uma NF-e no formato do fornecedor de kit: um item só, componentes na observação. */
export const XML_KIT = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe${CHAVE}" versao="4.00">
    <ide><cUF>28</cUF><nNF>1234</nNF><serie>1</serie><dhEmi>2026-11-20T10:15:00-03:00</dhEmi></ide>
    <emit><CNPJ>00000000000191</CNPJ><xNome>DISTRIBUIDORA SOLAR EXEMPLO LTDA</xNome></emit>
    <det nItem="1">
      <prod><cProd>KIT-55</cProd><xProd>KIT GERADOR FOTOVOLTAICO 5,5 KWP</xProd><uCom>UN</uCom>
        <qCom>1.0000</qCom><vUnCom>14500.0000000000</vUnCom><vProd>14500.00</vProd></prod>
    </det>
    <total><ICMSTot><vNF>14500.00</vNF></ICMSTot></total>
    <infAdic><infCpl>KIT COMPOSTO POR: 10 MODULOS FOTOVOLTAICOS JA SOLAR 550W; 01 INVERSOR GROWATT MIN 5000TL-X; 01 STRING BOX 2E/2S; 40 M CABO SOLAR 6MM PRETO; 40 M CABO SOLAR 6MM VERMELHO; 04 PAR CONECTOR MC4; VALOR APROXIMADO DOS TRIBUTOS R$ 1.234,56 (LEI 12.741/2012); DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL</infCpl></infAdic>
  </infNFe></NFe>
  <protNFe><infProt><chNFe>${CHAVE}</chNFe></infProt></protNFe>
</nfeProc>`;

/** Uma nota normal, com os itens na lista e a observação só de aviso. */
const XML_LISTA = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${CHAVE.replace(/5$/, "6")}">
  <ide><nNF>88</nNF><dEmi>2026-10-02</dEmi></ide>
  <emit><CNPJ>00000000000272</CNPJ><xNome>CABOS &amp; CONECTORES EXEMPLO</xNome></emit>
  <det nItem="1"><prod><cProd>C6</cProd><xProd>CABO SOLAR 6MM</xProd><uCom>MT</uCom><qCom>100.0000</qCom><vUnCom>5.5</vUnCom></prod></det>
  <det nItem="2"><prod><cProd>MC4</cProd><xProd>CONECTOR MC4 PAR</xProd><uCom>PC</uCom><qCom>20</qCom><vUnCom>9.9</vUnCom></prod>
    <infAdProd>LOTE 33</infAdProd></det>
  <infAdic><infCpl>PEDIDO 555 - VENDEDOR FULANO</infCpl></infAdic>
</infNFe></NFe>`;

export function testarEstoque(confere: Confere, _igual?: Igual): void {
  // O `igual` do testar-regras compara com ===; aqui há listas e objetos.
  const igual = <T,>(obtido: T, esperado: T, o_que: string) =>
    confere(isDeepStrictEqual(obtido, esperado), `${o_que} — esperava ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`);
  // ---------------------------------------------------------------- números e unidades
  igual(numeroBr("1.234,5"), 1234.5, "número com milhar e vírgula");
  igual(numeroBr("10.0000"), 10, "número do XML com ponto decimal");
  igual(numeroBr("1.000"), 1000, "milhar sem vírgula");
  igual(numeroBr("2,5"), 2.5, "vírgula decimal");
  igual(numeroBr("abc"), null, "texto não é número");
  igual(normalizarUnidade("UND"), "un", "UND vira un");
  igual(normalizarUnidade("PÇ"), "un", "PÇ vira un");
  igual(normalizarUnidade("MT"), "m", "MT vira m");
  igual(normalizarUnidade("Rolo"), "rolo", "rolo continua rolo");
  igual(normalizarUnidade(""), "un", "sem unidade vira un");
  igual(chaveDoNome("Cabo Solar 6 mm"), chaveDoNome("CABO SOLAR 6MM"), "chave ignora caixa e espaço");
  igual(quantidadeValida("2,5"), 2.5, "quantidade com vírgula vale");
  igual(quantidadeValida(0), null, "quantidade zero não vale");
  igual(quantidadeValida(-3), null, "quantidade negativa não vale");
  igual(quantidadeValida("dez"), null, "quantidade em texto não vale");

  // ---------------------------------------------------------------- XML
  confere(ehXmlDeNota(XML_KIT), "reconhece o XML da NF-e (nfeProc)");
  confere(ehXmlDeNota("﻿" + XML_LISTA), "reconhece o XML da NF-e com BOM e sem <?xml");
  confere(!ehXmlDeNota("<html><body>oi</body></html>"), "HTML não é nota");
  confere(!ehXmlDeNota("%PDF-1.7"), "PDF não é XML");

  const kit = lerXmlDaNota(XML_KIT);
  confere(kit !== null, "lê a nota do kit");
  if (kit) {
    igual(kit.numero, "1234", "número da nota");
    igual(kit.chaveAcesso, CHAVE, "chave de acesso de 44 dígitos");
    igual(kit.emitidaEm, "2026-11-20", "data de emissão");
    igual(kit.fornecedor, "DISTRIBUIDORA SOLAR EXEMPLO LTDA", "fornecedor");
    igual(kit.cnpjFornecedor, "00000000000191", "CNPJ do fornecedor");
    igual(kit.valorTotal, 14500, "valor da nota");
    igual(kit.itens.length, 1, "a lista da nota tem um item só");
    igual(kit.itens[0]?.quantidade, 1, "quantidade do XML");
    confere(Boolean(kit.observacao?.includes("MODULOS")), "a observação vem junto");
  }
  const lista = lerXmlDaNota(XML_LISTA);
  igual(lista?.itens.map((i) => [i.descricao, i.quantidade, i.unidade]), [
    ["CABO SOLAR 6MM", 100, "m"],
    ["CONECTOR MC4 PAR", 20, "un"],
  ], "nota com a lista completa");
  igual(lista?.fornecedor, "CABOS & CONECTORES EXEMPLO", "entidade &amp; decodificada");
  igual(lista?.emitidaEm, "2026-10-02", "data no formato antigo (dEmi)");
  igual(lerXmlDaNota("<nada/>"), null, "XML sem infNFe não é nota");

  // ---------------------------------------------------------------- itens na observação
  const obs = itensDoTexto(kit?.observacao);
  igual(
    obs.map((i) => [i.descricao, i.quantidade, i.unidade]),
    [
      ["MODULOS FOTOVOLTAICOS JA SOLAR 550W", 10, "un"],
      ["INVERSOR GROWATT MIN 5000TL-X", 1, "un"],
      ["STRING BOX 2E/2S", 1, "un"],
      ["CABO SOLAR 6MM PRETO", 40, "m"],
      ["CABO SOLAR 6MM VERMELHO", 40, "m"],
      ["CONECTOR MC4", 4, "par"],
    ],
    "observação do kit vira seis itens, sem o aviso dos tributos",
  );
  igual(
    itensDoTexto("Modulo JA Solar 550W - 10 UN\nInversor Growatt MIN 5000TL-X - 1 UN\nCabo solar 6mm (50 M)").map((i) => [i.descricao, i.quantidade, i.unidade]),
    [
      ["Modulo JA Solar 550W", 10, "un"],
      ["Inversor Growatt MIN 5000TL-X", 1, "un"],
      ["Cabo solar 6mm", 50, "m"],
    ],
    "quantidade escrita depois do nome",
  );
  igual(
    itensDoTexto("MODULO 550W QTD: 12 | ESTRUTURA TELHADO CERAMICO QTDE 3 | 10x Conector MC4").map((i) => [i.descricao, i.quantidade]),
    [
      ["MODULO 550W", 12],
      ["ESTRUTURA TELHADO CERAMICO", 3],
      ["Conector MC4", 10],
    ],
    "QTD:, QTDE e 10x",
  );
  igual(
    itensDoTexto("10 MODULOS 550W, 1 INVERSOR 5KW, 2 STRING BOX").map((i) => [i.descricao, i.quantidade]),
    [
      ["MODULOS 550W", 10],
      ["INVERSOR 5KW", 1],
      ["STRING BOX", 2],
    ],
    "itens separados por vírgula",
  );
  igual(itensDoTexto("KIT GERADOR 5,5 KWP").length, 0, "potência com vírgula não vira item");
  igual(itensDoTexto("550W MODULO MONOCRISTALINO").length, 0, "número colado em letra não é quantidade");
  igual(itensDoTexto("Pedido 555 - Vendedor Fulano\nVencimento 10/12").length, 0, "dados do pedido não são item");
  igual(itensDoTexto("OBS: 6 GRAMPOS INTERMEDIARIOS").map((i) => i.quantidade), [6], "rótulo antes dos dois-pontos");
  igual(itensDoTexto(null).length, 0, "sem observação, sem itens");

  // ---------------------------------------------------------------- juntar
  const juntas = kit ? juntarItensDaNota(kit.itens, kit.observacao) : [];
  igual(juntas.length, 7, "o kit e os seis componentes aparecem na conferência");
  igual(juntas[0]?.entra, false, "o item único da nota (o kit) começa fora: é o resumo");
  confere(Boolean(juntas[0]?.motivo?.includes("Resumo do kit")), "e diz por quê");
  confere(juntas.slice(1).every((l) => l.entra && l.origem === "observacao"), "os componentes da observação entram");

  const normal = lista ? juntarItensDaNota(lista.itens, lista.observacao) : [];
  igual(normal.map((l) => [l.origem, l.entra]), [["lista", true], ["lista", true]], "nota normal: a lista entra inteira");

  const comAdProd = juntarItensDaNota(
    [{ codigo: null, descricao: "KIT SOLAR 3KWP", quantidade: 1, unidade: "un", valorUnitario: null, informacaoAdicional: "06 MODULOS 550W; 01 MICROINVERSOR 2KW" }],
    null,
  );
  igual(comAdProd.map((l) => [l.descricao, l.entra]), [
    ["KIT SOLAR 3KWP", false],
    ["MODULOS 550W", true],
    ["MICROINVERSOR 2KW", true],
  ], "itens escritos embaixo do item (infAdProd) também contam");

  const lista2 = juntarItensDaNota(
    [
      { codigo: "A", descricao: "MODULO JA SOLAR 550W", quantidade: 10, unidade: "un", valorUnitario: 600, informacaoAdicional: null },
      { codigo: "B", descricao: "INVERSOR GROWATT MIN 5000TL-X", quantidade: 1, unidade: "un", valorUnitario: 4000, informacaoAdicional: null },
    ],
    "10 MODULO JA SOLAR 550W; 1 INVERSOR GROWATT MIN 5000TL-X",
  );
  igual(lista2.map((l) => l.entra), [true, true, false, false], "observação que repete a lista começa fora");

  const pedido = marcarRepetidos([
    ...juntas,
    { descricao: "MODULO FOTOVOLTAICO JA SOLAR 550W", quantidade: 10, unidade: "un", codigo: null, valorUnitario: null, origem: "pedido", entra: true, motivo: null, itemId: null, modeloId: null },
    { descricao: "ESTRUTURA PARA TELHADO", quantidade: 3, unidade: "un", codigo: null, valorUnitario: null, origem: "pedido", entra: true, motivo: null, itemId: null, modeloId: null },
  ]);
  igual(pedido.slice(-2).map((l) => l.entra), [false, true], "pedido: o que já está na nota começa fora, o novo entra");

  // ---------------------------------------------------------------- sugestão
  const itens = [
    { id: "i-mod", nome: "Módulo JA Solar 550W", codigo: null, modeloEquipamentoId: "m-ja" },
    { id: "i-cabo", nome: "Cabo solar 6mm preto", codigo: "C6P", modeloEquipamentoId: null },
  ];
  const modelos = [
    { id: "m-ja", fabricante: "JA Solar", modelo: "JAM72S30 550" },
    { id: "m-gw", fabricante: "Growatt", modelo: "MIN 5000TL-X" },
  ];
  igual(sugerirItem({ descricao: "INVERSOR GROWATT MIN 5000TL-X", codigo: null }, itens, modelos), { itemId: null, modeloId: "m-gw" }, "modelo do catálogo pela descrição, item novo");
  igual(sugerirItem({ descricao: "CABO SOLAR 6MM PRETO", codigo: null }, itens, modelos), { itemId: "i-cabo", modeloId: null }, "item pelo nome igual");
  igual(sugerirItem({ descricao: "CABO 6 PRETO", codigo: "C6P" }, itens, modelos), { itemId: "i-cabo", modeloId: null }, "item pelo código do fornecedor");
  igual(sugerirItem({ descricao: "MODULO JAM72S30-550/MR", codigo: null }, itens, modelos), { itemId: "i-mod", modeloId: "m-ja" }, "item pelo modelo do catálogo");
  igual(sugerirItem({ descricao: "PARAFUSO", codigo: null }, itens, modelos), { itemId: null, modeloId: null }, "na dúvida, nada");
  const comCores = [
    ...itens,
    { id: "i-verm", nome: "Cabo solar 6mm vermelho", codigo: null, modeloEquipamentoId: null },
    { id: "i-mc4", nome: "Conector MC4 (par)", codigo: null, modeloEquipamentoId: null },
  ];
  igual(sugerirItem({ descricao: "MODULOS FOTOVOLTAICOS JA SOLAR 550W", codigo: null }, comCores, []).itemId, "i-mod", "descrição com outras palavras acha o mesmo módulo");
  igual(sugerirItem({ descricao: "MODULO JA SOLAR 585W", codigo: null }, comCores, []).itemId, null, "potência diferente não é o mesmo módulo");
  igual(sugerirItem({ descricao: "CABO SOLAR 6MM AZUL", codigo: null }, comCores, []).itemId, null, "cabo de outra cor não cai no preto nem no vermelho");
  igual(sugerirItem({ descricao: "CONECTOR MC4", codigo: null }, comCores, []).itemId, "i-mc4", "“CONECTOR MC4” acha “Conector MC4 (par)”");

  // ---------------------------------------------------------------- baixa
  const m = (o: Record<string, number>) => new Map(Object.entries(o));
  igual(diferencaDaBaixa(m({ a: 10, b: 2 }), m({})), [
    { itemId: "a", quantidade: -10, motivo: "os" },
    { itemId: "b", quantidade: -2, motivo: "os" },
  ], "material registrado: sai do estoque");
  igual(diferencaDaBaixa(m({ a: 10 }), m({ a: 10 })), [], "rodar de novo não lança nada");
  igual(diferencaDaBaixa(m({ a: 8 }), m({ a: 10 })), [{ itemId: "a", quantidade: 2, motivo: "estorno" }], "corrigiu para menos: estorna a diferença");
  igual(diferencaDaBaixa(m({ a: 12.5 }), m({ a: 10 })), [{ itemId: "a", quantidade: -2.5, motivo: "os" }], "corrigiu para mais: sai a diferença");
  igual(diferencaDaBaixa(m({}), m({ a: 10, b: 2 })), [
    { itemId: "a", quantidade: 10, motivo: "estorno" },
    { itemId: "b", quantidade: 2, motivo: "estorno" },
  ], "OS cancelada: tudo volta");
  igual(diferencaDaBaixa(m({ a: 0.1 + 0.2 }), m({ a: 0.3 })), [], "sem lançamento por arredondamento");

  igual(saldoDe([{ quantidade: "10" }, { quantidade: -3 }, { quantidade: "-2.5" }]), 4.5, "saldo é a soma do livro");
  igual(situacaoDoSaldo(-1, null), "negativo", "saldo negativo é marcado");
  igual(situacaoDoSaldo(0, 5), "zerado", "zerado");
  igual(situacaoDoSaldo(3, 5), "baixo", "abaixo do mínimo");
  igual(situacaoDoSaldo(5, 5), "ok", "no mínimo está ok");
  igual(situacaoDoSaldo(3, null), "ok", "sem mínimo, sem aviso");
}
