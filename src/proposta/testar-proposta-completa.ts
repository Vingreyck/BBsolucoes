/**
 * Conferências da proposta completa (23/11): base de equipamentos, municípios,
 * tarifa da ANEEL, simulação mês a mês com rateio, kit, preço, parcelas,
 * premissas e o assistente inteiro até o PDF. Chamado pelo `testar-regras.ts`.
 */

import { baseDeEquipamentos, itemDaBase, procurarNaBase } from "../equipamentos/base";
import { lerPlanilhaDePrecos, lerPreco, linhasDoCsv } from "../equipamentos/planilha";
import { ehMicroinversor, fasesDoNome, limparModelo, modeloInvalido, nomeDoFabricante, potenciaDoNome } from "../equipamentos/regras";
import { calcularAssistente, lerEstado, novaUc, type ContextoDoCalculo, type EstadoDaProposta } from "./assistente";
import { calcular } from "./calculo";
import { avaliarKit, modulosParaPotencia, potenciaNecessariaKwp, sugerirInversores, type InversorCandidato } from "./dimensionamento";
import { distanciaKm, distribuidoraPorNome, municipio, procurarMunicipios } from "./municipios";
import { formasDePagamento, parcelaPrice } from "./pagamentos";
import { calcularPreco } from "./precificacao";
import { lerPremissas, premissasDoFormulario, SUGESTAO, temCamposNovos } from "./premissas";
import { montarPropostaDoAssistente } from "./proposta";
import { gerarPropostaPdf } from "./proposta-pdf";
import { simular, taxaInternaDeRetorno, type UcDaSimulacao } from "./simulacao";
import { comImpostos, valorDaAneel, vigenteEm } from "./tarifas";

type Confere = (condicao: boolean, o_que: string) => void;
type Igual = <T>(obtido: T, esperado: T, o_que: string) => void;

const perto = (a: number | null | undefined, b: number, tol = 1e-6) => a !== null && a !== undefined && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/** O estado de uma proposta típica: Itabaiana, 500 kWh, Jinko 585 W e Growatt. */
export function estadoDeExemplo(): EstadoDaProposta {
  const e = lerEstado({ cidade: "Itabaiana", uf: "SE" })!;
  e.ucs = [novaUc(1, { consumoMedia: 500, ligacao: "bifasico", distribuidoraCnpj: "13017462000163", distribuidoraNome: "Energisa Sergipe" })];
  e.modulo = { modeloId: null, baseId: null, tipo: "modulo", fabricante: "Jinko Solar", modelo: "JKM585N-72HL4-V", potenciaW: 585, qtd: 7, precoUnitario: 650 };
  e.inversores = [
    { modeloId: null, baseId: null, tipo: "inversor", fabricante: "Growatt", modelo: "MIN 3600TL-X", potenciaW: 3600, qtd: 1, precoUnitario: 3200, fases: 1 },
  ];
  e.telhado = "Fibrocimento";
  e.outrosItens = [{ nome: "Estrutura fibrocimento", qtd: 1, precoUnitario: 900 }];
  return e;
}

export function contextoDeExemplo(): ContextoDoCalculo {
  return {
    premissas: SUGESTAO,
    irradiacaoCidade: municipio("Itabaiana", "SE")?.irradiacaoMensal ?? null,
    tarifas: {
      "13017462000163|B1": { te: 0.27181, tusd: 0.4828, fioB: 0.25499, vigenciaInicio: "2026-04-22", vigenciaFim: "2027-04-21", resolucao: "RESOLUÇÃO HOMOLOGATÓRIA Nº 3.575, DE 22 DE ABRIL DE 2026" },
    },
    distanciaKm: 0,
    anoBase: 2026,
  };
}

export function testarPropostaCompleta(confere: Confere, igual: Igual): void {
  // --- nomes de equipamento -------------------------------------------------------
  igual(nomeDoFabricante("JINKO SOLAR CO., LTD"), "Jinko Solar", "fabricante: Jinko escrito por extenso");
  igual(nomeDoFabricante("283 - SOLIS"), "Solis", "fabricante: código na frente sai");
  igual(nomeDoFabricante("Ginlong (Solis)"), "Solis", "fabricante: Ginlong é Solis");
  igual(nomeDoFabricante("JAMES ENERGIA"), "JAMES ENERGIA", "fabricante: 'JA' só vale para JA Solar");
  igual(potenciaDoNome("MIN 5000TL-X"), 5000, "potência: Growatt MIN 5000TL-X");
  igual(potenciaDoNome("SUN-M225G4-EU-Q0"), 2250, "potência: Deye SUN-M225G4 é 2,25 kW");
  igual(potenciaDoNome("SIW200G M050 W1"), 5000, "potência: WEG M050 é 5 kW");
  igual(potenciaDoNome("SUN2000-5KTL-L1"), 5000, "potência: Huawei SUN2000-5KTL (o 2000 é a linha)");
  igual(potenciaDoNome("S6-GR1P7.5K2"), 7500, "potência: Solis 7,5 kW");
  igual(potenciaDoNome("HMS-2000DW-4T"), 2000, "potência: Hoymiles HMS-2000");
  igual(potenciaDoNome("SG5.0RS-L"), 5000, "potência: Sungrow SG5.0RS");
  igual(potenciaDoNome("Primo 5.0-1"), 5000, "potência: Fronius Primo 5.0");
  confere(ehMicroinversor("Deye", "SUN-M225G4-EU-Q0") && ehMicroinversor("Growatt", "NEO 2250M-X2"), "micro: Deye SUN-M e Growatt NEO");
  confere(!ehMicroinversor("Growatt", "MIN 5000TL-X") && !ehMicroinversor("Huawei", "SUN2000-5KTL-L1"), "não é micro: MIN e SUN2000-KTL");
  igual(fasesDoNome("Growatt", "MID 15KTL3-X", false), 3, "fases: Growatt MID é trifásico");
  igual(fasesDoNome("Solis", "S6-GR1P5K", false), 1, "fases: Solis GR1P é monofásico");
  igual(limparModelo("JAM72S30-550/MR 550W", "JA Solar"), "JAM72S30-550/MR", "modelo: a potência repetida no fim sai");
  igual(limparModelo("HN18N-72H585W", "Hanersun"), "HN18N-72H585W", "modelo: potência que é parte do nome fica");
  igual(limparModelo("JA Solar JAM72S30-550/MR", "JA Solar"), "JAM72S30-550/MR", "modelo: o fabricante repetido na frente sai");
  confere(modeloInvalido("Não há") && modeloInvalido("550") && !modeloInvalido("MIN 5000TL-X"), "modelo inválido: 'Não há' e só a potência");

  // --- planilha de preços do distribuidor ------------------------------------------
  confere(lerPreco("R$ 1.234,56") === 1234.56 && lerPreco("650") === 650 && lerPreco("abc") === null, "preço da planilha em reais");
  const plan = lerPlanilhaDePrecos([
    ["Tabela de preços novembro"],
    ["Marca", "Produto", "Categoria", "Potência (W)", "Preço"],
    ["Jinko", "JKM585N-72HL4-V 585W", "Módulo", "585", "R$ 640,00"],
    ["", "GROWATT MIN 5000TL-X", "Inversor", "5000", "3.150,00"],
    ["Deye", "SUN-M225G4-EU-Q0", "", "", "2.890,90"],
    ["", "", "", "", ""],
    ["Total", "", "", "", ""],
  ]);
  igual(plan.itens.length, 3, "planilha: 3 produtos lidos, a linha sem preço é ignorada");
  confere(plan.itens[0].fabricante === "Jinko Solar" && plan.itens[0].modelo === "JKM585N-72HL4-V" && plan.itens[0].tipo === "modulo", "planilha: módulo com a potência repetida no nome limpa");
  confere(plan.itens[1].fabricante === "Growatt" && plan.itens[1].modelo === "MIN 5000TL-X", "planilha: fabricante tirado do começo do produto");
  confere(plan.itens[2].tipo === "microinversor" && plan.itens[2].preco === 2890.9, "planilha: sem tipo, o nome diz que é micro");
  confere(lerPlanilhaDePrecos([["a", "b"], ["1", "2"]]).semCabecalho, "planilha sem coluna de modelo e preço: avisa");
  igual(linhasDoCsv(['modelo;preço', '"MIN 5000TL-X";3150,00'].join("\n"))[1][1], "3150,00", "CSV com ponto e vírgula e aspas");

  // --- a base de equipamentos ----------------------------------------------------
  const base = baseDeEquipamentos();
  confere(base.itens.length > 3000, `base de equipamentos carregada (${base.itens.length} modelos)`);
  confere(base.fonte.includes("ODbL"), "a base diz a fonte e a licença (ODbL)");
  const min = procurarNaBase("min 5000", ["inversor"]);
  confere(min[0]?.fabricante === "Growatt" && /MIN 5000TL-X/.test(min[0].modelo), "busca 'min 5000' acha o Growatt MIN 5000TL-X primeiro");
  confere(min[0]?.potenciaW === 5000 && min[0]?.fases === 1, "MIN 5000TL-X: 5 kW monofásico");
  const deye = procurarNaBase("sun-m225g4", ["microinversor"])[0];
  igual(deye?.modulosPorUnidade ?? null, 4, "Deye SUN-M225G4: 4 módulos por micro, tirado das usinas cadastradas");
  const ja = procurarNaBase("JAM72S30-550", ["modulo"])[0];
  confere(ja?.potenciaW === 550 && Boolean(ja.eletrico?.vocV), "JA Solar 550 W com tensão e corrente da lista da CEC");
  confere(itemDaBase(ja?.id) === ja, "item da base pelo id");
  confere(procurarNaBase("", ["microinversor"], 5).length === 5, "sem texto, os mais instalados");

  // --- municípios ----------------------------------------------------------------
  const ita = municipio("Itabaiana", "SE");
  confere(perto(ita?.irradiacaoAnual, 5.256, 0.002), `Itabaiana: 5,26 kWh/m²·dia no Atlas do INPE (${ita?.irradiacaoAnual})`);
  igual(ita?.distribuidoras[0]?.nome, "Energisa Sergipe", "Itabaiana é Energisa Sergipe");
  igual(municipio("Estância", "SE")?.distribuidoras[0]?.nome, "Sulgipe", "Estância é Sulgipe");
  igual(municipio("itabaiana")?.uf, "SE", "Itabaiana sem UF: a de Sergipe");
  confere(procurarMunicipios("itab")[0]?.nome === "Itabaiana", "busca de cidade começa por Sergipe");
  const aju = municipio("Aracaju", "SE")!;
  confere(ita !== null && distanciaKm(ita, aju) > 35 && distanciaKm(ita, aju) < 55, "Itabaiana fica a uns 45 km de Aracaju");
  igual(distribuidoraPorNome("Energisa Sergipe")?.cnpj, "13017462000163", "distribuidora pelo nome gravado no projeto");
  igual(distribuidoraPorNome("sulgipe")?.sigla, "SULGIPE", "Sulgipe pelo nome");

  // --- tarifa -----------------------------------------------------------------------
  confere(perto(valorDaAneel("482,80"), 0.4828), "ANEEL: 482,80 R$/MWh é 0,4828 R$/kWh");
  confere(perto(comImpostos(0.75461, { icms: 0.2, pisCofins: 0.05 }), 1.006147), "tarifa com ICMS e PIS/COFINS por dentro");
  const vig = vigenteEm(
    [
      { DatInicioVigencia: "2025-04-22", DatFimVigencia: "2026-04-21", v: 1 },
      { DatInicioVigencia: "2026-04-22", DatFimVigencia: "2027-04-21", v: 2 },
      { DatInicioVigencia: "2027-04-22", DatFimVigencia: "2028-04-21", v: 3 },
    ],
    "2026-11-23",
  );
  igual(vig?.v, 2, "vale a resolução em vigor hoje, nem a velha nem a futura");

  // --- simulação --------------------------------------------------------------------
  const plano = Array.from({ length: 12 }, () => 5.2557);
  const uma: UcDaSimulacao = { id: "a", nome: "Casa", geradora: true, ligacao: "bifasico", consumoMes: Array(12).fill(445), tarifa: 1, fioB: 0.27 };
  const nova = simular({
    kwp: 3.72, irradiacaoMensal: plano, desempenho: 0.75, simultaneidade: 0.3, ucs: [uma], rateio: "percentual",
    investimento: 10431.95, reajusteAnual: 0.05, degradacaoAnual: 0.007, tma: 0.1, anoBase: 2026,
  });
  const antiga = calcular({ kwp: 3.72, consumoKwh: 445, investimento: 10431.95, ligacao: "bifasico", anoBase: 2026 }, { ...SUGESTAO, irradiacaoDia: 5.2557, fioBKwh: 0.27 });
  confere(perto(nova.producaoAno, antiga.producaoAno, 1e-9), "mesma geração anual que o cálculo antigo, com o sol igual todo mês");
  confere(perto(nova.economiaAno1, antiga.economiaAno1, 1e-6), `uma unidade e consumo constante: a mesma economia do cálculo antigo (${nova.economiaAno1.toFixed(2)} × ${antiga.economiaAno1.toFixed(2)})`);
  confere(nova.paybackMeses !== null && nova.paybackDescontadoMeses! >= nova.paybackMeses!, "retorno descontado vem depois do simples");
  confere(nova.tir !== null && nova.tir > 0.1 && nova.vpl > 0, "TIR acima da TMA e VPL positivo num sistema que se paga em ~3 anos");
  confere(perto(taxaInternaDeRetorno([-100, 110]), 0.1, 1e-6), "TIR de −100 e +110 é 10%");

  // Duas unidades: a geradora consome pouco e o excedente vai para a outra.
  const ger: UcDaSimulacao = { id: "g", nome: "Loja", geradora: true, ligacao: "monofasico", consumoMes: Array(12).fill(100), tarifa: 1, fioB: 0.3 };
  const ben: UcDaSimulacao = { id: "b", nome: "Casa", geradora: false, ligacao: "bifasico", consumoMes: Array(12).fill(400), tarifa: 1, fioB: 0.3, percentual: 1 };
  const comum = { kwp: 3.5, irradiacaoMensal: plano, desempenho: 0.75, simultaneidade: 0.3, investimento: 15000, reajusteAnual: 0, degradacaoAnual: 0, tma: 0.1, anoBase: 2026 };
  const pct = simular({ ...comum, ucs: [ger, ben], rateio: "percentual" });
  const pri = simular({ ...comum, ucs: [ger, ben], rateio: "prioridade" });
  confere(pct.ucs[1].economiaMes > 0 && pct.ucs[1].compensadoAno > 0, "rateio: a beneficiária compensa com o excedente da geradora");
  confere(perto(pct.economiaAno1, pri.economiaAno1, 1e-6), "100% para uma beneficiária e prioridade dão a mesma economia");
  const meia = simular({ ...comum, ucs: [ger, { ...ben, percentual: 0.5 }], rateio: "percentual" });
  confere(meia.ucs[1].compensadoAno < pct.ucs[1].compensadoAno, "com 50% do excedente a beneficiária compensa menos");
  confere(meia.sobraCreditosAno1 > 0, "o que a geradora não usa vira crédito guardado");
  const grande = simular({ ...comum, kwp: 12, ucs: [uma], rateio: "percentual" });
  confere(grande.sobraCreditosAno1 > 1000 && grande.cobertura > 2, "sistema grande demais: sobra crédito e a cobertura passa de 200%");
  confere(grande.contaComMes >= 50 * 0.99, "conta com a usina nunca abaixo do custo de disponibilidade");

  // --- dimensionamento e kit ---------------------------------------------------------
  const irrIta = ita!.irradiacaoMensal;
  const kwpNec = potenciaNecessariaKwp([{ ligacao: "bifasico", consumoMes: Array(12).fill(500) }], irrIta, 0.75);
  confere(perto(kwpNec, 5400 / (ita!.irradiacaoAnual * 365 * 0.75), 0.003), `500 kWh bifásico em Itabaiana: ${kwpNec?.toFixed(2)} kWp`);
  igual(modulosParaPotencia(3.75, 585), 7, "3,75 kWp com módulo de 585 W: 7 módulos");
  const cand: InversorCandidato[] = [
    { id: "3", nome: "MIN 3000", tipo: "inversor", potenciaW: 3000, fases: 1 },
    { id: "36", nome: "MIN 3600", tipo: "inversor", potenciaW: 3600, fases: 1 },
    { id: "5", nome: "MIN 5000", tipo: "inversor", potenciaW: 5000, fases: 1 },
    { id: "t", nome: "MID 10K", tipo: "inversor", potenciaW: 10000, fases: 3 },
    { id: "m", nome: "SUN-M225G4", tipo: "microinversor", potenciaW: 2250, modulosPorUnidade: 4, fases: 1 },
  ];
  const sobre = { alvo: 1.15, maximo: 1.35 };
  igual(sugerirInversores({ qtd: 7, potenciaW: 585 }, cand, sobre, "bifasico", "inversor")?.[0].inversor.id, "36", "7 × 585 W: o MIN 3600 (CC/CA 1,14, perto do alvo)");
  const mic = sugerirInversores({ qtd: 10, potenciaW: 585 }, cand, sobre, "bifasico", "microinversor");
  igual(mic?.[0].qtd, 3, "10 módulos com micro de 4 entradas: 3 micros");
  confere(
    sugerirInversores({ qtd: 30, potenciaW: 585 }, cand.filter((c) => c.fases === 3), sobre, "bifasico", "inversor") === null,
    "trifásico não serve em casa bifásica",
  );
  const avisos = avaliarKit({ modulos: { qtd: 10, potenciaW: 585 }, inversores: [{ nome: "SUN-M225G4", tipo: "microinversor", potenciaW: 2250, qtd: 2, modulosPorUnidade: 4 }], sobre, ligacao: "bifasico" });
  confere(avisos.some((a) => a.nivel === "erro" && a.texto.includes("entradas")), "10 módulos e 8 entradas: avisa que faltam entradas");
  const tri = avaliarKit({ modulos: { qtd: 20, potenciaW: 585 }, inversores: [{ nome: "MID 10K", tipo: "inversor", potenciaW: 10000, qtd: 1, fases: 3 }], sobre, ligacao: "monofasico" });
  confere(tri.some((a) => a.nivel === "erro" && a.texto.includes("trifásico")), "inversor trifásico em casa monofásica: erro");

  // --- preço -------------------------------------------------------------------------
  const preco = calcularPreco({ custoKit: 10000, kwp: 4.095, modulos: 7, inversores: 1, telhado: "Fibrocimento", distanciaKm: 0 }, SUGESTAO);
  confere(perto(preco.custoTotal, 10000 + 900 + 400 * 4.095 + 150 * 4.095 + 200), `custo: kit + projeto + mão de obra + CA + frete (${preco.custoTotal})`);
  igual(preco.precoSugerido, Math.ceil(preco.custoTotal / (1 - 0.2 - 0.06) / 10) * 10, "preço por dentro (margem 20% + imposto 6%), arredondado de 10 em 10");
  const longe = calcularPreco({ custoKit: 10000, kwp: 4.095, modulos: 7, inversores: 1, telhado: null, distanciaKm: 100 }, SUGESTAO);
  confere(longe.linhas.some((l) => l.id === "logistica" && perto(l.valor, (100 - 40) * 2 * 2.5)), "deslocamento além do raio: ida e volta a R$ 2,50/km");
  const semFrete = calcularPreco({ custoKit: 10000, kwp: 4, modulos: 7, inversores: 1, telhado: null, distanciaKm: 0, ajustes: { frete: { ativo: false } } }, SUGESTAO);
  confere(!semFrete.linhas.some((l) => l.id === "frete"), "custo desligado na proposta não entra");

  // --- parcelas ------------------------------------------------------------------------
  confere(perto(parcelaPrice(10000, 0.01, 12), 888.4879, 1e-6), "Price: 10 mil a 1% em 12x dá R$ 888,49");
  igual(parcelaPrice(1200, 0, 12), 100, "sem juros: dividido por igual");
  const fp = formasDePagamento(20000, SUGESTAO);
  confere(fp.cartao !== null && fp.cartao.opcoes[fp.cartao.opcoes.length - 1].parcelas === 21, "cartão até 21x");
  confere(fp.financiamentos[0].opcoes.length === 7 && fp.financiamentos[0].opcoes[0].valorParcela > fp.financiamentos[0].opcoes[6].valorParcela, "financiamento: prazo maior, parcela menor");

  // --- premissas antigas e novas -------------------------------------------------------
  const antigas = { ...SUGESTAO } as Record<string, unknown>;
  for (const k of ["tributos", "perfisDesempenho", "perfisSimultaneidade", "sobredimensionamento", "tma", "precificacao", "logistica", "pagamento"]) delete antigas[k];
  const lidas = lerPremissas(antigas);
  confere(lidas !== null && lidas.precificacao.itens.length > 0 && lidas.tributos.icms === 0.2, "premissas salvas antes de 23/11 continuam valendo, com o resto da sugestão");
  confere(!temCamposNovos(antigas) && temCamposNovos(SUGESTAO), "a tela sabe quando as premissas são antigas");
  const form = premissasDoFormulario({
    tarifaKwh: "1,00", fioBKwh: "0,34", irradiacaoDia: "5,26", desempenho: "75", simultaneidade: "30", reajusteAnual: "5",
    degradacaoAnual: "0,7", validadeDias: "10", garantiaInversor: "10", garantiaPlacas: "12", garantiaEstrutura: "10",
    garantiaEficiencia: "25", cartaoParcelas: "21", cartaoTaxa: "0,8", carencia: "120", numeroInicial: "",
    icms: "20", pisCofins: "5", sobreAlvo: "115", sobreMaximo: "135", tma: "10", margem: "20", imposto: "6", arredondar: "10",
    margemPorDentro: "dentro", logisticaCidade: "Itabaiana", logisticaUf: "SE", raioKm: "40", valorKm: "2,5", aVistaDesconto: "5",
    perfisDesempenho: JSON.stringify([{ nome: "Norte", valor: 78 }]),
    perfisSimultaneidade: JSON.stringify([{ nome: "Casa", valor: 30 }]),
    custos: JSON.stringify([{ id: "mo", nome: "Mão de obra", tipo: "por_kwp", valor: 450, grupo: "servico" }, { id: "fr", nome: "Frete", tipo: "percentual", valor: 2, base: "kit", grupo: "outro" }]),
    financiamentos: JSON.stringify([{ nome: "Banco X", taxaMes: 1.2, prazos: [60, 36], carenciaDias: 90 }]),
  });
  confere(form !== null && perto(form.perfisDesempenho[0].valor, 0.78) && perto(form.precificacao.itens[1].valor, 0.02), "formulário: perfis e percentuais digitados em %, gravados em fração");
  confere(form !== null && form.pagamento.financiamentos[0].prazos.join() === "36,60" && perto(form.pagamento.aVistaDesconto, 0.05), "formulário: prazos em ordem e desconto à vista");
  igual(premissasDoFormulario({ ...{ tarifaKwh: "1" }, margem: "80", imposto: "30" }), null, "margem + imposto por dentro de 110% não forma preço");

  // --- o assistente inteiro -------------------------------------------------------------
  const est = estadoDeExemplo();
  const ctx = contextoDeExemplo();
  const r = calcularAssistente(est, ctx);
  igual(r.falta.length, 0, `proposta típica: nada falta (${r.falta.join("; ")})`);
  confere(r.tarifas[0].origem === "aneel" && perto(r.tarifas[0].tarifa, (0.27181 + 0.4828) / 0.75), "a tarifa da unidade vem da ANEEL com os impostos");
  confere(r.kwpNecessario !== null && r.kwp > 0 && r.simulacao !== null && r.precoFinal! > 0, "o assistente calcula potência, preço e economia");
  confere(perto(r.custoKit, 7 * 650 + 3200 + 900), "custo do kit: soma dos preços unitários");
  const manual = calcularAssistente({ ...est, custoKitManual: 12000 }, ctx);
  igual(manual.custoKit, 12000, "preço do kit digitado vale sobre a soma");
  const comDesconto = calcularAssistente({ ...est, precoFinal: r.preco!.precoSugerido - 500 }, ctx);
  confere(comDesconto.margemFinal! < r.margemFinal!, "dar desconto diminui a margem");
  const semConsumo = calcularAssistente({ ...est, ucs: [novaUc(1)] }, ctx);
  confere(semConsumo.falta.some((f) => f.includes("consumo")), "sem consumo, falta o consumo");
  const lixo = lerEstado({ ucs: [{ nome: 123, consumoMedia: "abc", subgrupo: "Z9" }], modulo: { tipo: "inversor" }, precoFinal: -5 });
  confere(lixo !== null && lixo.ucs[0].geradora && lixo.ucs[0].subgrupo === "B1" && lixo.modulo === null && lixo.precoFinal === null, "estado com lixo vira estado em branco, sem quebrar");
}

/** O PDF da proposta feita no assistente, com uma e com duas unidades. */
export async function testarPdfDoAssistente(confere: Confere, igual: Igual): Promise<void> {
  const est = estadoDeExemplo();
  const ctx = contextoDeExemplo();
  const casos: [string, EstadoDaProposta][] = [
    ["uma unidade", est],
    [
      "duas unidades com rateio",
      {
        ...est,
        observacoes: "Inclui a troca do padrão de entrada.",
        ucs: [
          { ...est.ucs[0], consumoModo: "mensal", consumoMeses: [520, 500, 510, 480, 430, 400, 390, 410, 450, 500, 530, 540] },
          novaUc(2, { nome: "Casa da mãe", consumoMedia: 250, percentual: 0.4, distribuidoraCnpj: "13017462000163", distribuidoraNome: "Energisa Sergipe" }),
        ],
        modulo: { ...est.modulo!, qtd: 12 },
        inversores: [{ ...est.inversores[0], modelo: "MIN 6000TL-X", potenciaW: 6000 }],
      },
    ],
  ];
  for (const [nome, e] of casos) {
    const r = calcularAssistente(e, ctx);
    igual(r.falta.length, 0, `assistente (${nome}): nada falta (${r.falta.join("; ")})`);
    const dados = montarPropostaDoAssistente(e, r, {
      numero: 300,
      hoje: new Date("2026-11-23T12:00:00Z"),
      empresa: { nome: "Empresa Exemplo" },
      cliente: { nome: "Cliente Exemplo" },
      responsavel: { nome: "Vendedor Exemplo", contato: "(79) 99999-0000" },
      premissas: ctx.premissas,
      fonteIrradiacao: "Atlas Brasileiro de Energia Solar (INPE, 2017), Itabaiana/SE",
      fontesDeTarifa: e.ucs.map((u) => u.distribuidoraNome),
    });
    const lido = JSON.parse(JSON.stringify(dados)) as typeof dados;
    confere((lido.ucs?.length ?? 0) === (e.ucs.length > 1 ? 2 : 0), `proposta (${nome}) leva a tabela por unidade só quando há mais de uma`);
    confere(Boolean(lido.premissas.fonteTarifa?.includes("3.575")), `proposta (${nome}) cita a resolução da ANEEL`);
    const pdf = await gerarPropostaPdf(lido, { logo: null });
    confere(pdf.subarray(0, 5).toString("latin1") === "%PDF-", `PDF do assistente (${nome})`);
    const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    igual(paginas, 7, `PDF do assistente (${nome}) com 7 páginas (${paginas})`);
    if (process.env.PROPOSTA_AMOSTRA2 && nome !== "uma unidade") {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.PROPOSTA_AMOSTRA2, pdf);
    }
  }
}
