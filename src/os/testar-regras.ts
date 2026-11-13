/**
 * As regras do checklist que não precisam de banco: quando um item está
 * cumprido (observação obrigatória, foto no lugar da explicação, "agendar") e
 * que arquivo é foto, vídeo ou lixo.
 *
 *   npm run testar:regras
 *
 * O `testar-os.ts` cobre o resto, de ponta a ponta, mas pede o Postgres. Estas
 * são as contas que o app espelha no celular (`RegrasOs.cumprido`) — se mudarem
 * aqui, mudam lá, e o `RegrasOsTest` do app tem os mesmos casos.
 */

import { cumprido, faltaNoItem, type ItemParaRegra, type SituacaoDoItem } from "./regras-item";
import { avaliarRodada } from "../sistema/alertas";
import { verificarBackupExterno, verificarBackupLocal, verificarColetor, verificarDisco } from "../sistema/saude";
import { classesDaPilha, desembaralhar, lerClasses } from "../sistema/retrace";
import { avaliarVersao, lerMinimos } from "../app-movel/versao";
import { lerDsn, montarEnvelope } from "../sistema/sentry";
import { tipoReal } from "./tipo-arquivo";
import { arquivoPendente, cabeNoDeposito, caminhoPendente } from "./deposito-local";
import { verificarAnexosPendentes } from "../sistema/saude";
import {
  diasEntre,
  faltaNoDossie,
  tiposEntregues,
  linkWhatsapp,
  mensagemDeCobranca,
  numeroWhatsapp,
  pedidosAoCliente,
  primeiroNome,
} from "../documentos/cobranca";
import { ordenarFila, type LinhaCobranca } from "../documentos/fila-cobranca";
import { descricaoDaOs, usinasParadas } from "./usina-parada";
import {
  acaoNaEsteira,
  faseDe,
  liberaOsDeInstalacao,
  nomeNoEmpreendimento,
  normalizarItem,
  sugerirProjetos,
  vigente,
  vinculoAutomatico,
} from "../energisa/situacoes";
import { CAMPOS, codigoDoFavorito, ORIGEM_ENERGISA } from "../energisa/favorito";
import { montarZip } from "../energisa/extensao";
import { conferirEnvio, dadosParaOPortal, lerNumeroDoPortal } from "../energisa/envio";
import {
  classificar,
  referenciaDoParque,
  diasDoMes,
  mensagemDoRelatorio,
  mesAnterior,
  mesLegivel,
  numeroBr as numeroBrGeracao,
  resumirMes,
  ultimoMesFechado,
} from "../geracao/relatorio-mensal";
import { montarAssertiva, montarMensagem } from "../push/fcm";
import { montarCorpoApns, montarJwtApns, tokenMorto } from "../push/apns";
import { quandoLegivel, textoDoAviso } from "../push/texto";
import { generateKeyPairSync, randomBytes, scryptSync, verify } from "node:crypto";
import { conferirSenha, custoDoHash, gerarHash, gerarSenhaProvisoria, HASH_FANTASMA, verificarSenha } from "../auth/senha";
import { tipoDoDocumento } from "../documentos/conteudo";
import { mfaAtivo, mfaAtivoNoApp, rotuloDoDispositivo } from "../auth/mfa";
import {
  abrirSegredo,
  base32Codificar,
  base32Decodificar,
  cifrarSegredo,
  codigoDoPasso,
  enderecoOtpauth,
  novoSegredo,
  passoDe,
  podeCifrarSegredo,
  verificarCodigo,
} from "../auth/totp";
import { mascarar } from "../sistema/seguranca";
import {
  dadosDoClienteQueFaltam,
  faltaDaEmpresa,
  faltaParaContrato,
  fraseDoPagamento,
  inteiroPorExtenso,
  mensagemDeDadosDoCliente,
  mensagemDoContrato,
  montarContrato,
  reaisPorExtenso,
  rotuloDoPedidoDeDados,
  type EntradaContrato,
} from "../projeto/contrato";
import { gerarContratoPdf, nomeDoContrato } from "../projeto/contrato-pdf";
import { potenciaLegivel, rotuloDoModelo, sugestaoDeEquipamentos, textoDoKit } from "../projeto/kit";
import { diasCorridos, fraseDoTempo, rotuloDoTempo } from "../projeto/tempo";
import {
  distribuidoraDaCidade,
  estruturaDoTelhado,
  faltaParaOProjeto,
  lerDadosTecnicos,
  lerVistoria,
  OPCOES_DE_TELHADO,
} from "../projeto/da-vistoria";
import { readFileSync } from "node:fs";

let falhas = 0;
let total = 0;

function confere(condicao: boolean, o_que: string): void {
  total++;
  if (!condicao) {
    falhas++;
    console.error(`  ✗ ${o_que}`);
  }
}

function igual<T>(obtido: T, esperado: T, o_que: string): void {
  confere(obtido === esperado, `${o_que} — esperava ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`);
}

const base: ItemParaRegra = { tipoResposta: "texto", fotosMinimas: 0, exigeObservacao: "nao", permiteAgendar: false };
const item = (extra: Partial<ItemParaRegra>): ItemParaRegra => ({ ...base, ...extra });
const sit = (extra: Partial<SituacaoDoItem>): SituacaoDoItem => ({ valor: null, fotos: 0, observacao: null, agendar: false, ...extra });

// --- sem regra nova, tudo como era ---------------------------------------------

confere(cumprido(item({}), sit({ valor: "x" })), "texto respondido, sem foto pedida: cumprido");
confere(!cumprido(item({}), sit({})), "texto sem resposta: não");
confere(!cumprido(item({ fotosMinimas: 1 }), sit({ valor: "x" })), "foto pedida e ausente: não");
confere(cumprido(item({ fotosMinimas: 1 }), sit({ valor: "x", fotos: 1 })), "foto pedida e presente: sim");
confere(!cumprido(item({ tipoResposta: "check" }), sit({ valor: false })), "check desmarcado: não");
confere(cumprido(item({ tipoResposta: "sim_nao" }), sit({ valor: false })), "sim/não com 'não': cumprido");
confere(!cumprido(item({ tipoResposta: "multipla" }), sit({ valor: [] })), "múltipla vazia: não");
confere(cumprido(item({ tipoResposta: "foto" }), sit({ fotos: 1 })), "tipo foto com 1 foto: sim");
confere(!cumprido(item({ tipoResposta: "foto" }), sit({})), "tipo foto sem foto: não");

// --- sem_foto: a explicação vale no lugar da foto -------------------------------

const semFoto = item({ tipoResposta: "numero", fotosMinimas: 1, exigeObservacao: "sem_foto" });
confere(!cumprido(semFoto, sit({ valor: 40 })), "sem_foto: sem foto e sem observação: não");
confere(cumprido(semFoto, sit({ valor: 40, observacao: "poste na frente, sem como fotografar" })), "sem_foto: a observação vale no lugar da foto");
confere(cumprido(semFoto, sit({ valor: 40, fotos: 1 })), "sem_foto: com foto, a observação é opcional");
confere(!cumprido(semFoto, sit({ valor: 40, observacao: "   " })), "sem_foto: observação só com espaços não conta");
confere(!cumprido(semFoto, sit({ observacao: "explicação, mas sem a resposta" })), "sem_foto: a resposta continua sendo exigida");

const fachada = item({ tipoResposta: "foto", fotosMinimas: 1, exigeObservacao: "sem_foto" });
confere(!cumprido(fachada, sit({})), "item de foto, sem_foto: nada: não");
confere(cumprido(fachada, sit({ observacao: "portão fechado, ninguém atendeu" })), "item de foto, sem_foto: a observação basta");

// --- sempre: observação com foto ou sem ------------------------------------------

const aterramento = item({ tipoResposta: "escolha", fotosMinimas: 1, exigeObservacao: "sempre" });
confere(!cumprido(aterramento, sit({ valor: "Não existe", fotos: 1 })), "sempre: com foto e sem observação: não");
confere(!cumprido(aterramento, sit({ valor: "Não existe", observacao: "sem haste" })), "sempre: a observação NÃO substitui a foto");
confere(cumprido(aterramento, sit({ valor: "Não existe", fotos: 1, observacao: "sem haste, cabo solto" })), "sempre: foto + observação: sim");

const rasgar = item({ tipoResposta: "sim_nao", exigeObservacao: "sempre" });
confere(!cumprido(rasgar, sit({ valor: true })), "rasgar parede: sim sem observação: não");
confere(cumprido(rasgar, sit({ valor: false, observacao: "o cabo passa pelo forro" })), "rasgar parede: não + observação: sim");
confere(!cumprido(rasgar, sit({ observacao: "só a observação" })), "rasgar parede: observação sem resposta: não");

// --- agendar ----------------------------------------------------------------------

const sombra = item({ tipoResposta: "escolha", fotosMinimas: 1, exigeObservacao: "sem_foto", permiteAgendar: true });
confere(cumprido(sombra, sit({ agendar: true })), "agendar num item que permite: cumprido sem mais nada");
confere(!cumprido(item({ tipoResposta: "escolha", fotosMinimas: 1 }), sit({ agendar: true })), "agendar num item que NÃO permite: não vale");
confere(!cumprido(sombra, sit({ agendar: false })), "agendar desfeito: volta a exigir");

// --- o que falta, em palavras ------------------------------------------------------

igual(faltaNoItem(aterramento, sit({})), "Falta a resposta, 1 foto e a observação", "falta: tudo");
igual(faltaNoItem(aterramento, sit({ valor: "Existe e está bom", fotos: 1 })), "Falta a observação", "falta: só a observação");
igual(faltaNoItem(semFoto, sit({ valor: 40 })), "Falta 1 foto (ou a observação do porquê)", "falta: foto que a observação substitui");
igual(faltaNoItem(semFoto, sit({ valor: 40, observacao: "sem acesso" })), null, "falta: nada");
igual(faltaNoItem(item({ tipoResposta: "check" }), sit({})), "Falta marcar como feito", "falta: check");
igual(faltaNoItem(item({ fotosMinimas: 2 }), sit({ valor: "x", fotos: 1 })), "Falta 1 foto", "falta: uma de duas fotos");

// --- que arquivo é este -------------------------------------------------------------

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const caixa = (marca: string) => bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...[...marca].map((c) => c.charCodeAt(0)));

igual(tipoReal(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg", "JPEG");
igual(tipoReal(bytes(0x89, 0x50, 0x4e, 0x47)), "image/png", "PNG");
igual(tipoReal(bytes(0x25, 0x50, 0x44, 0x46)), "application/pdf", "PDF");
igual(tipoReal(caixa("isom")), "video/mp4", "MP4 (Android)");
igual(tipoReal(caixa("mp42")), "video/mp4", "MP4 (mp42)");
igual(tipoReal(caixa("qt  ")), "video/quicktime", "MOV (iPhone)");
igual(tipoReal(bytes(0x4d, 0x5a, 0x90, 0x00)), null, "executável não é foto");
igual(tipoReal(new Uint8Array([1, 2, 3])), null, "arquivo curto demais");


// --- alertas do coletor e rota de saúde ---------------------------------------------

const ok = (nome: string, critica = false) => ({ nome, estado: "ok" as const, critica });
const falhou = (nome: string, critica = false) => ({ nome, estado: "falhou" as const, critica });
{
  let a = avaliarRodada([falhou("Coleta Growatt")], {}, 40);
  confere(!a.alerta, "coleta de portal que falha uma vez não alerta");
  a = avaliarRodada([falhou("Coleta Growatt")], { "Coleta Growatt": 2 }, 40);
  confere(a.alerta && a.motivos[0].includes("3 rodadas"), "a terceira falha seguida alerta");
  a = avaliarRodada([ok("Coleta Growatt")], { "Coleta Growatt": 2 }, 40);
  confere(!a.alerta && a.falhasSeguidas["Coleta Growatt"] === 0, "dar certo zera a contagem");
  confere(avaliarRodada([falhou("Cópia", true)], {}, 40).alerta, "etapa crítica alerta na primeira falha");
  confere(avaliarRodada([ok("x")], {}, 90).alerta, "disco a 90% alerta");
  const pulada = avaliarRodada([{ nome: "Coleta Growatt", estado: "pulada" }], { "Coleta Growatt": 2 }, 40);
  confere(pulada.falhasSeguidas["Coleta Growatt"] === 2, "etapa pulada não zera a contagem");
}
{
  const agora = Date.parse("2026-10-28T12:00:00Z");
  const h = (n: number) => new Date(agora - n * 3_600_000).toISOString();
  confere(verificarColetor({ fim: h(1), alerta: false, motivos: [] }, agora).ok, "coletor rodou há 1 h: ok");
  confere(!verificarColetor({ fim: h(4), alerta: false, motivos: [] }, agora).ok, "coletor parado há 4 h: problema");
  confere(!verificarColetor({ fim: h(1), alerta: true, motivos: ["x"] }, agora).ok, "rodada com alerta: problema");
  confere(!verificarColetor(null, agora).ok, "sem rodada registrada: problema");
  confere(verificarBackupLocal(agora - 10 * 3_600_000, agora).ok, "cópia local de 10 h: ok");
  confere(!verificarBackupLocal(agora - 40 * 3_600_000, agora).ok, "cópia local de 40 h: problema");
  confere(!verificarBackupLocal(null, agora).ok, "sem cópia local: problema");
  confere(!verificarBackupExterno(false, null, agora).ok, "cópia externa não configurada: problema");
  confere(verificarBackupExterno(true, { ok: true, quando: h(5) }, agora).ok, "envio ao Drive de 5 h: ok");
  confere(!verificarBackupExterno(true, { ok: false, quando: h(1), erro: "x" }, agora).ok, "envio ao Drive que falhou: problema");
  confere(!verificarBackupExterno(true, { ok: true, quando: h(50) }, agora).ok, "envio ao Drive de 50 h: problema");
  confere(verificarDisco(70).ok && !verificarDisco(85).ok, "disco: 70% ok, 85% problema");
}


// --- desembaralhar a pilha do Android -----------------------------------------------
async function testarRetrace() {
  const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const pasta = mkdtempSync(join(tmpdir(), "retrace-"));
  const mapeamento = join(pasta, "mapping.txt");
  writeFileSync(
    mapeamento,
    [
      "br.com.selebi.app.nucleo.dados.FilaEnvio -> H2.K0:",
      '# {"id":"sourceFile","fileName":"FilaEnvio.kt"}',
      "    36:77:void aceito(br.com.selebi.app.X,int):200:241 -> a",
      "    78:90:void enviar():10:22 -> b",
      "    78:90:void helper():5:17 -> b",
      "    void semLinha() -> c",
      "br.com.selebi.app.Outra -> a.b:",
      "    1:3:void y():9:9 -> a",
    ].join(String.fromCharCode(10)),
  );
  const pilha = ["H2.K0: falhou", "\tat H2.K0.a(SourceFile:40)", "\tat H2.K0.b(SourceFile:80)", "\tat H2.K0.c(SourceFile)", "\tat H2.K0.zz(SourceFile:1)", "\tat lib.Estranha.f(Estranha.java:7)"].join(String.fromCharCode(10));
  const classes = await lerClasses(mapeamento, classesDaPilha(pilha));
  const linhas = desembaralhar(pilha, classes).split(String.fromCharCode(10));
  confere(linhas[0] === "br.com.selebi.app.nucleo.dados.FilaEnvio: falhou", "a classe da exceção volta ao nome de verdade");
  confere(linhas[1].includes("FilaEnvio.aceito(FilaEnvio.kt:204)"), "linha ofuscada 40 vira a linha 204 do original (200 + 40 - 36)");
  confere(linhas[2].includes("FilaEnvio.enviar(FilaEnvio.kt:12)") && linhas[3].includes("FilaEnvio.helper(FilaEnvio.kt:7)"), "método embutido vira dois quadros");
  confere(linhas[4].includes("FilaEnvio.semLinha(FilaEnvio.kt)"), "método sem linha no mapeamento");
  confere(linhas[5].includes("FilaEnvio.zz(FilaEnvio.kt:1)"), "método que não está no mapeamento mantém a classe e a linha");
  confere(linhas[6] === "\tat lib.Estranha.f(Estranha.java:7)", "classe fora do mapeamento fica como veio");
  confere(!classes.has("a.b"), "só as classes da pilha são lidas");
  rmSync(pasta, { recursive: true });
}

// --- versão mínima do app -----------------------------------------------------------
{
  const min = { android: 6, ios: 4 };
  const ped = (build: string | null, plataforma: string | null, agente: string | null = null) => ({ build, plataforma, agente });
  confere(avaliarVersao(ped("6", "android"), min).ok, "build igual ao mínimo passa");
  confere(avaliarVersao(ped("9", "android"), min).ok, "build maior passa");
  confere(!avaliarVersao(ped("5", "android"), min).ok, "build menor que o mínimo é barrado");
  confere(!avaliarVersao(ped(null, null, "okhttp/4.12"), min).ok, "app antigo, sem cabeçalho, é barrado como Android");
  confere(!avaliarVersao(ped(null, null, "Selebi-iOS/0.1.0 (iOS 18)"), min).ok, "iPhone antigo, só pelo User-Agent, é barrado pelo mínimo do iOS");
  confere(avaliarVersao(ped("4", "ios"), min).ok && !avaliarVersao(ped("3", "ios"), min).ok, "o mínimo do iPhone é o do iPhone");
  confere(avaliarVersao(ped(null, null), { android: 0, ios: 0 }).ok, "sem mínimo definido, ninguém é barrado");
  confere(avaliarVersao(ped("lixo", "android"), min).ok === false, "build ilegível conta como 0");
  const lido = lerMinimos({ APP_BUILD_MINIMO_ANDROID: " 6 ", APP_BUILD_MINIMO_IOS: "abc" });
  confere(lido.android === 6 && lido.ios === 0, "o .env é lido com espaço e ignora lixo");
}

// --- Sentry sem SDK -----------------------------------------------------------------
{
  const dsn = lerDsn("https://abc123@o999.ingest.sentry.io/4567");
  confere(dsn?.url === "https://o999.ingest.sentry.io/api/4567/envelope/" && dsn.chave === "abc123", "DSN vira o endereço do envelope");
  confere(lerDsn("") === null && lerDsn("lixo") === null && lerDsn(undefined) === null, "DSN vazio ou inválido não envia");
  const linhas = montarEnvelope(dsn!, { mensagem: "boom", plataforma: "android", tags: { versao: "0.1.0" } }).split(String.fromCharCode(10));
  const evento = JSON.parse(linhas[2]);
  confere(linhas.length === 3 && JSON.parse(linhas[1]).type === "event", "envelope tem três linhas");
  confere(evento.exception.values[0].value === "boom" && evento.tags.versao === "0.1.0" && evento.tags.plataforma === "android", "evento leva mensagem e tags");
}

// --- Robô da Energisa -------------------------------------------------------------------
{
  igual(faseDe("P"), "aprovado", "P é Projeto Aprovado");
  igual(faseDe("I"), "indeferido", "I é Projeto Indeferido");
  igual(faseDe("M"), "conectada", "M é UC GD Conectada");
  igual(faseDe("J"), "vistoria_reprovada", "J é Vistoria Reprovada");
  igual(faseDe("H"), "vistoria_pendente", "H é Vistoria Pendente");
  igual(faseDe(null, "Etapa de Obra"), "obra", "\"Etapa de Obra\", que não está na tabela deles, vira obra pela descrição");
  igual(faseDe("?", "Projeto em Análise"), "analise", "código desconhecido cai na descrição");
  confere(liberaOsDeInstalacao("aprovado") && liberaOsDeInstalacao("obra") && !liberaOsDeInstalacao("analise"), "só aprovado (ou em obra) libera a OS de instalação");

  igual(acaoNaEsteira("conectada", "pedido_vistoria"), "avancar", "UC GD conectada no pedido de vistoria avança para monitoramento");
  igual(acaoNaEsteira("vistoria_aprovada", "pedido_vistoria"), "avancar", "vistoria aprovada no pedido de vistoria já avança: a esteira não espera a ligação");
  igual(acaoNaEsteira("vistoria_pendente", "pedido_vistoria"), null, "vistoria ainda pendente não mexe");
  igual(acaoNaEsteira("vistoria_reprovada", "pedido_vistoria"), "voltar", "vistoria reprovada volta para execução");
  igual(acaoNaEsteira("conectada", "execucao"), null, "fora do pedido de vistoria, a esteira não se mexe sozinha");
  igual(acaoNaEsteira("aprovado", "aprovacao_concessionaria"), null, "aprovação não move: libera o botão da OS");
  igual(acaoNaEsteira("analise", "projeto"), "avancar", "projeto registrado na Energisa (em análise): sai da etapa Projeto");
  igual(acaoNaEsteira("aprovado", "projeto"), "avancar", "projeto já aprovado e ainda na etapa Projeto: avança");
  igual(acaoNaEsteira("indeferido", "projeto"), null, "projeto indeferido não avança: volta para correção");
  igual(acaoNaEsteira("cancelado", "projeto"), null, "projeto cancelado no portal não avança");
  igual(acaoNaEsteira("desconhecida", "projeto"), null, "situação desconhecida não avança às cegas");
  igual(acaoNaEsteira("analise", "documentacao"), null, "fora de Projeto e Pedido de vistoria, a esteira não se mexe");

  const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const v = vigente([
    { id: "v1", fase: "indeferido" as const, dataAbertura: d("2026-10-22") },
    { id: "v2", fase: "aprovado" as const, dataAbertura: d("2026-10-19") },
    { id: "v0", fase: "indeferido" as const, dataAbertura: d("2026-10-08") },
  ]);
  igual(v?.id, "v2", "vale a entrada viva, mesmo mais antiga que a indeferida (Rosangela V3 x V2)");
  igual(vigente([{ id: "a", fase: "indeferido" as const, dataAbertura: d("2026-10-01") }, { id: "b", fase: "cancelado" as const, dataAbertura: d("2026-10-05") }])?.id, "b", "todas mortas: a mais recente");

  igual(nomeNoEmpreendimento("PE Solar Sr Jose Edenilson - BB Solucoes - 28 10 2026").join(" "), "jose edenilson", "nome tirado do empreendimento");
  igual(nomeNoEmpreendimento("PE SOLAR USINA ITALO V4 75KW - BB SOLUCOES - 05 10 2026").join(" "), "italo", "sem usina, versão e potência");
  igual(nomeNoEmpreendimento("PE AUMENTO GD - ELIAS MADERE V2 - BB SOLUCOES - 19 09 2026").join(" "), "elias madere", "no aumento, o nome vem depois do traço");
  const candidatos = [
    { projetoId: "p1", cliente: "José Edenilson Santos" },
    { projetoId: "p2", cliente: "José Carlos Peixoto" },
    { projetoId: "p3", cliente: "Antônio Anderson Almeida" },
  ];
  igual(vinculoAutomatico("PE Solar Sr Jose Edenilson - BB Solucoes - 28 10 2026", candidatos), "p1", "nome completo e único vincula sozinho");
  igual(vinculoAutomatico("ANTÔNIO ANDERSON ALMEIDA", candidatos), "p3", "empreendimento com o nome do cliente vincula");
  igual(vinculoAutomatico("PE Solar Sr Jose Soares - BB Solucoes", candidatos), null, "só o \"José\" não basta");
  confere(sugerirProjetos("PE Solar Sr Jose Carlos Cond Peixoto - BB Solucoes", candidatos)[0]?.projetoId === "p2", "sugestão pelo nome ignora \"Cond\"");

  const item = normalizarItem({
    numeroProjetoEletrico: 1236226,
    nomeEmpreendimento: "PE Solar Sr Jose Edenilson - BB Solucoes - 28 10 2026",
    descricaoLogradouro: "RUA JOSE HENIO ARAUJO",
    numeroEndereco: "379",
    nomeBairro: "OVIEDO TEIXEIRA",
    codigoUF: "SE",
    dataAberturaISO: "2026-10-28T10:00:00",
    codigoSituacaoProjetoEletrico: "a",
    descricaoSituacaoProjetoEletrico: "Projeto em Análise",
  });
  confere(item?.numero === "1236226" && item.fase === "analise" && item.codigo === "A", "a linha da página vira número, código e fase");
  igual(item?.endereco, "RUA JOSE HENIO ARAUJO, 379, OVIEDO TEIXEIRA, SE", "endereço montado como na tela deles");
  igual(normalizarItem({ nomeEmpreendimento: "sem número" }), null, "linha sem ID Geração é ignorada");

  const fav = codigoDoFavorito("https://app.selebi.com.br/");
  confere(fav.startsWith("javascript:") && !fav.includes("\n"), "o favorito é uma linha só, começando por javascript:");
  const corpo = decodeURIComponent(fav.slice("javascript:".length));
  let compila = true;
  try {
    new Function(corpo);
  } catch {
    compila = false;
  }
  confere(compila, "o código do favorito é JavaScript válido");
  confere(corpo.includes('"https://app.selebi.com.br"') && !corpo.includes("selebi.com.br//"), "o favorito manda só para a origem do Selebi, sem barra a mais");
  confere(corpo.includes("servicos.energisa.com.br") && corpo.includes("dadosServerSide"), "o favorito só roda no portal e lê a lista da página");

  const manifesto = JSON.parse(readFileSync("extensao/manifest.json", "utf8")) as { host_permissions: string[]; manifest_version: number };
  const fundo = readFileSync("extensao/background.js", "utf8");
  igual(manifesto.manifest_version, 3, "a extensão é Manifest V3");
  confere(manifesto.host_permissions.includes(`${ORIGEM_ENERGISA}/*`), "a extensão tem permissão no portal da Energisa");
  const selebiDaExtensao = /const SELEBI = "([^"]+)"/.exec(fundo)?.[1] ?? "";
  confere(manifesto.host_permissions.includes(`${selebiDaExtensao}/*`), "a extensão tem permissão no Selebi para onde envia");
  const camposDaExtensao = /const CAMPOS = (\[[^\]]*\])/.exec(fundo)?.[1] ?? "[]";
  igual(JSON.stringify(JSON.parse(camposDaExtensao.replace(/,\s*\]/, "]"))), JSON.stringify(CAMPOS), "extensão e favorito levam os mesmos campos");
  let extensaoCompila = true;
  try {
    new Function(fundo);
  } catch {
    extensaoCompila = false;
  }
  confere(extensaoCompila, "o código da extensão é JavaScript válido");
  const ponte = readFileSync("extensao/selebi.js", "utf8");
  let ponteCompila = true;
  try {
    new Function(ponte);
  } catch {
    ponteCompila = false;
  }
  confere(ponteCompila, "o script da extensão nas páginas do Selebi é JavaScript válido");
  const scripts = (manifesto as unknown as { content_scripts?: { matches: string[]; js: string[] }[] }).content_scripts ?? [];
  confere(
    scripts.length === 1 && scripts[0].matches.join() === `${selebiDaExtensao}/*` && scripts[0].js.join() === "selebi.js",
    "a ponte com o botão do dossiê roda só nas páginas do Selebi",
  );
  confere(
    ponte.includes("e.source !== window") && ponte.includes("e.origin !== location.origin"),
    "a ponte só aceita mensagem da própria página do Selebi",
  );
  confere(
    fundo.includes("sender.url?.startsWith(`${SELEBI}/`)") && fundo.includes("/api/energisa/envio/"),
    "o pedido de envio só vale vindo do Selebi e busca os dados na rota do envio",
  );
  confere(!/\.click\(\)|\.submit\(\)|requestSubmit/.test(fundo), "a extensão não clica nem envia formulário no portal");
  confere(!/innerHTML/.test(fundo), "o painel no portal não monta HTML com os dados");

  const zip = montarZip([
    { nome: "selebi-energisa/manifest.json", dados: Buffer.from("{}") },
    { nome: "selebi-energisa/ícone.txt", dados: Buffer.from("ok") },
  ]);
  igual(zip.readUInt32LE(0), 0x04034b50, "o zip começa pelo cabeçalho do primeiro arquivo");
  const fimZip = zip.length - 22;
  igual(zip.readUInt32LE(fimZip), 0x06054b50, "o zip termina no registro de fim");
  igual(zip.readUInt16LE(fimZip + 10), 2, "o zip lista os dois arquivos");
  igual(zip.readUInt32LE(zip.readUInt32LE(fimZip + 16)), 0x02014b50, "o fim aponta para o diretório central");
}

// --- OS automática para usina parada ---------------------------------------------------
{
  const agora = new Date("2026-10-30T15:00:00Z");
  const alerta = (id: string, usinaId: string, dia: string, mensagem = "Não gerou nada") => ({
    id, usinaId, abertoEm: new Date(`${dia}T12:00:00Z`), mensagem,
  });
  const paradas = usinasParadas(
    [
      alerta("a1", "u-dois-dias", "2026-10-28"),
      alerta("a2", "u-dois-dias", "2026-10-29"),
      alerta("b1", "u-um-dia", "2026-10-29"),
      alerta("c1", "u-antiga", "2026-10-10"),
      alerta("c2", "u-antiga", "2026-10-11"),
      alerta("d1", "u-morta", "2026-10-29", "Praticamente sem geração: não gerou em nenhum dos 30 dias"),
      alerta("e1", "u-repetida", "2026-10-29"),
      alerta("e2", "u-repetida", "2026-10-29"),
    ],
    agora,
  );
  const ids = paradas.map((p) => p.usinaId).sort().join(",");
  igual(ids, "u-dois-dias,u-morta", "OS só para 2 dias parados recentes ou usina sem geração no período");
  confere(!ids.includes("u-um-dia"), "um dia parado ainda não abre OS (pode ser o disjuntor religado)");
  confere(!ids.includes("u-antiga"), "alerta antigo não vira OS no dia em que a regra liga");
  confere(!ids.includes("u-repetida"), "dois alertas no mesmo dia contam como um dia");
  const desc = descricaoDaOs(paradas.find((p) => p.usinaId === "u-dois-dias")!);
  confere(desc.includes("28/10, 29/10") && desc.includes("Aberta automaticamente"), "a descrição diz os dias parados e que foi automática");
}

// --- Relatório mensal de geração ----------------------------------------------------
{
  igual(diasDoMes("2026-02"), 28, "fevereiro de 2026 tem 28 dias");
  igual(diasDoMes("2028-02"), 29, "fevereiro bissexto tem 29");
  igual(mesAnterior("2026-01"), "2025-12", "o mês antes de janeiro é dezembro do ano anterior");
  igual(ultimoMesFechado(new Date(2026, 10, 5)), "2026-10", "em 5 de novembro, o mês fechado é outubro");
  igual(mesLegivel("2026-10"), "outubro de 2026", "mês por extenso");
  igual(numeroBrGeracao(1234.5, 1), "1.234,5", "número à brasileira");

  igual(classificar(3.0), "abaixo", "sem régua do parque, 3,0 kWh/kWp/dia está abaixo da faixa anual de Sergipe");
  igual(classificar(5.6, 5.5), "dentro", "com a régua de outubro (5,5), 5,6 é normal — não 'acima'");
  igual(classificar(4.0, 5.5), "abaixo", "4,0 com régua 5,5 fica abaixo de 75% dela");
  igual(classificar(4.2, 5.5), "dentro", "4,2 com régua 5,5 ainda é normal (76%)");
  igual(classificar(3617, 5.5), "suspeita", "potência em MW (7 kWp gravado como 0,007) é suspeita, não avaliação");
  igual(referenciaDoParque([5, 5.5, 6, 3617, 0.1, null, 5.2, 4.8]), 5.2, "a régua é a mediana, sem as impossíveis e as quase paradas");
  igual(referenciaDoParque([5, 5.5]), null, "com menos de 5 usinas, não há régua");

  const dias = Array.from({ length: 28 }, (_, i) => ({ dia: `2026-10-${String(i + 1).padStart(2, "0")}`, kwh: 20 }));
  const r = resumirMes("2026-10", [...dias, { dia: "2026-10-05", kwh: 2 }, { dia: "2026-09-30", kwh: 99 }], 5);
  igual(r.diasComDado, 28, "dias com dado contados uma vez (dois inversores no mesmo dia somam)");
  igual(r.diasSemDado, 3, "outubro com 28 dias de dado tem 3 sem dado");
  igual(r.totalKwh, 562, "o total soma o mês e ignora dia de outro mês");
  confere(Math.abs((r.kwhPorKwpDia ?? 0) - 562 / 28 / 5) < 1e-9, "o desempenho usa a média dos dias com dado, não o mês inteiro");
  igual(r.faixa, "dentro", "20 kWh/dia numa usina de 5 kWp é normal");
  igual(r.serie[30], null, "o dia sem dado fica nulo no gráfico");
  igual(resumirMes("2026-10", dias.slice(0, 5), 5).faixa, null, "com menos de 7 dias, não avalia");
  igual(resumirMes("2026-10", dias, null).faixa, null, "sem potência cadastrada, não avalia");

  const msg = mensagemDoRelatorio({ cliente: "ANA LIMA", empresa: "BB Soluções", mes: "2026-10", resumo: r, link: "https://x/r/g/abc" });
  const suspeita = resumirMes("2026-10", dias, 0.005, 5.5);
  confere(
    suspeita.faixa === "suspeita" &&
      !mensagemDoRelatorio({ cliente: "Ana", empresa: "BB", mes: "2026-10", resumo: suspeita, link: "l" }).includes("Desempenho"),
    "potência suspeita: a mensagem ao cliente não fala de desempenho",
  );
  confere(msg.startsWith("Olá, Ana! Aqui é da BB Soluções.") && msg.includes("outubro de 2026"), "mensagem com nome, empresa e mês");
  confere(msg.includes("Gerou 562 kWh") && msg.includes("https://x/r/g/abc"), "mensagem com o total e o link do PDF");
  const ruim = resumirMes("2026-10", dias.map((d) => ({ ...d, kwh: 8 })), 5);
  confere(
    mensagemDoRelatorio({ cliente: "Ana", empresa: "BB", mes: "2026-10", resumo: ruim, link: "l" }).includes("nossa equipe vai verificar"),
    "usina abaixo do esperado: a mensagem diz que a equipe vai verificar",
  );
}

// --- Cobrança de documento ao cliente -------------------------------------------
{
  igual(numeroWhatsapp("(79) 99999-1234"), "5579999991234", "celular com DDD vira 55+DDD+número");
  igual(numeroWhatsapp("79 3211-4567"), "557932114567", "fixo com DDD também");
  igual(numeroWhatsapp("+55 79 99999-1234"), "5579999991234", "já com +55 fica igual");
  igual(numeroWhatsapp("0 41 79 99999-1234"), "5579999991234", "com o código da operadora, ele sai");
  igual(numeroWhatsapp("99999-1234"), null, "sem DDD não dá para saber o número");
  igual(numeroWhatsapp(null), null, "sem telefone, sem WhatsApp");
  igual(primeiroNome("  MARIA das dores silva"), "Maria", "primeiro nome com a primeira maiúscula");

  igual(
    pedidosAoCliente(["art", "foto_padrao", "uc_geradora", "memorial"]).join(","),
    "uc_geradora,foto_padrao",
    "só se cobra do cliente o que é dele, na ordem da mensagem",
  );
  const exig = [
    { tipo: "uc_geradora", obrigatorio: true, etapa: { ordem: 1 } },
    { tipo: "foto_padrao", obrigatorio: true, etapa: { ordem: 2 } },
    { tipo: "procuracao", obrigatorio: false, etapa: { ordem: 2 } },
    { tipo: "art", obrigatorio: true, etapa: { ordem: 4 } },
  ];
  igual(
    faltaNoDossie(2, exig, new Set(["uc_geradora"])).map((e) => e.tipo).join(","),
    "foto_padrao",
    "falta só o obrigatório até a etapa atual e que não está na pasta",
  );

  const primeira = mensagemDeCobranca({ cliente: "JOÃO SANTOS", empresa: "BB Soluções", tipos: ["foto_padrao", "uc_geradora"], jaCobrado: false });
  confere(primeira.startsWith("Olá, João! Aqui é da BB Soluções."), "mensagem abre com o nome e a empresa");
  confere(primeira.indexOf("conta de luz") < primeira.indexOf("padrão de energia"), "a conta de luz vem antes da foto do padrão");
  const lembrete = mensagemDeCobranca({ cliente: "João", empresa: "BB Soluções", tipos: ["foto_padrao"], jaCobrado: true });
  confere(lembrete.includes("passando para lembrar") && lembrete.includes("ainda falta:"), "a segunda cobrança é um lembrete, no singular");
  confere(linkWhatsapp("5579999991234", `a b${String.fromCharCode(10)}c`) === "https://wa.me/5579999991234?text=a%20b%0Ac", "o link leva o texto codificado");

  const agora = new Date(2026, 9, 30, 15);
  igual(diasEntre(new Date(2026, 9, 30, 8), agora), 0, "mesmo dia é hoje");
  igual(diasEntre(new Date(2026, 9, 29, 23), agora), 1, "ontem à noite é ontem");

  const linha = (id: string, cobradoHaDias: number | null, naEtapaHaDias: number): LinhaCobranca => ({
    projetoId: id, titulo: id, clienteId: id, cliente: id, telefone: null, whatsapp: null, etapa: "x",
    etapaDesde: new Date(agora.getTime() - naEtapaHaDias * 86_400_000), tipos: ["foto_padrao"],
    ultimaCobranca: cobradoHaDias === null ? null : { quando: new Date(agora.getTime() - cobradoHaDias * 86_400_000), por: null },
    vezes: cobradoHaDias === null ? 0 : 1,
  });
  const ordem = ordenarFila(
    [linha("cobrado-ontem", 1, 30), linha("cobrado-ha-9", 9, 10), linha("nunca-novo", null, 2), linha("nunca-antigo", null, 40)],
    agora.getTime(),
  ).map((l) => l.projetoId);
  igual(ordem.join(","), "nunca-antigo,nunca-novo,cobrado-ha-9,cobrado-ontem", "fila: nunca cobrado primeiro, cobrado há pouco no fim");
}

// --- Anexo no disco antes do Drive ----------------------------------------------
{
  const arq = "0b7f2c1e-1a2b-4c3d-8e9f-001122334455.jpg";
  igual(arquivoPendente(caminhoPendente(arq)), arq, "o caminho pendente devolve o nome do arquivo");
  igual(arquivoPendente("https://drive.google.com/file/d/abc/view"), null, "link do Drive não é pendente");
  igual(arquivoPendente("pendente://../../etc/passwd"), null, "nome com caminho é recusado");
  igual(arquivoPendente(null), null, "sem caminho, nada pendente");
  confere(cabeNoDeposito(70) && !cabeNoDeposito(80) && !cabeNoDeposito(95), "acima de 80% de disco vai direto ao Drive");
  confere(!cabeNoDeposito(null), "disco que não dá para medir conta como cheio");
  const agora = Date.UTC(2026, 9, 30, 12);
  confere(verificarAnexosPendentes({ quantidade: 0, maisAntigo: null }, agora).ok, "nenhum pendente está ok");
  confere(verificarAnexosPendentes({ quantidade: 3, maisAntigo: new Date(agora - 600_000) }, agora).ok, "pendente de 10 min está ok");
  confere(!verificarAnexosPendentes({ quantidade: 1, maisAntigo: new Date(agora - 7 * 3_600_000) }, agora).ok, "pendente de 7 h pede atenção");
}

// --- Push no iPhone (APNs sem SDK) ---------------------------------------------------
{
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const chave = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwt = montarJwtApns({ chave, keyId: "ABC123DEFG", teamId: "TEAM123456" }, 1_700_000_000_000);
  const [cab, corpo, assinatura] = jwt.split(".");
  const cabecalho = JSON.parse(Buffer.from(cab, "base64url").toString());
  confere(cabecalho.alg === "ES256" && cabecalho.kid === "ABC123DEFG", "JWT da Apple: ES256 com o id da chave");
  confere(JSON.parse(Buffer.from(corpo, "base64url").toString()).iss === "TEAM123456", "JWT da Apple leva o time");
  igual(Buffer.from(assinatura, "base64url").length, 64, "assinatura crua de 64 bytes (r‖s), como a Apple pede");
  confere(
    verify("sha256", Buffer.from(`${cab}.${corpo}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(assinatura, "base64url")),
    "a assinatura confere com a chave",
  );
  const apns = JSON.parse(montarCorpoApns({ titulo: "Nova ordem de serviço", corpo: "#0042", dados: { osId: "x", motivo: "atribuida" } }));
  confere(apns.aps.alert.title === "Nova ordem de serviço" && apns.osId === "x" && apns.aps.sound === "default", "corpo do APNs: texto em aps, osId ao lado");
  confere(tokenMorto(410, "Unregistered") && tokenMorto(400, "BadDeviceToken") && !tokenMorto(500, undefined), "410 e BadDeviceToken apagam o token");
}

// --- Push (FCM sem SDK) -------------------------------------------------------------
{
  igual(quandoLegivel("2026-10-30T14:30"), "30/10 14:30", "data do aviso em dia/mês e hora");
  confere(quandoLegivel(null) === null && quandoLegivel("lixo") === null, "data ausente ou inválida some do aviso");
  const normal = textoDoAviso("atribuida", { numero: 42, urgente: false, cliente: "Maria", quando: "30/10 14:30" });
  igual(normal.titulo, "Nova ordem de serviço", "título da OS atribuída");
  igual(normal.corpo, "#0042 · Maria · 30/10 14:30", "corpo: número, cliente e quando");
  igual(textoDoAviso("atribuida", { numero: 1, urgente: true }).titulo, "OS urgente para você", "urgente muda o título");
  igual(textoDoAviso("cancelada", { numero: 1, urgente: true }).titulo, "Ordem de serviço cancelada", "cancelada não vira urgente");
  igual(textoDoAviso("atribuida", { numero: 7, urgente: false }).corpo, "#0007", "sem cliente nem data, só o número");
  const msg = montarMensagem("tok", { titulo: "t", corpo: "c", dados: { osId: "x" } }).message;
  confere(msg.token === "tok" && msg.android.priority === "HIGH" && msg.data.osId === "x", "mensagem FCM: token, prioridade alta e dados");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = montarAssertiva({ client_email: "a@b.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, 1_700_000_000_000);
  const [cab, corpo] = jwt.split(".");
  confere(jwt.split(".").length === 3 && JSON.parse(Buffer.from(cab, "base64url").toString()).alg === "RS256", "JWT do Google é RS256 com três partes");
  confere(JSON.parse(Buffer.from(corpo, "base64url").toString()).exp === 1_700_003_600, "JWT vale 1 hora");
}

// --- Segurança: documento pelo conteúdo, e o que vai para o log ------------------------
{
  const bytes = (inicio: number[] | string, tamanho = 64) => {
    const b = new Uint8Array(tamanho);
    b.set(typeof inicio === "string" ? [...Buffer.from(inicio, "latin1")] : inicio);
    return b;
  };
  igual(tipoDoDocumento(bytes("%PDF-1.7\n"))?.extensao, ".pdf", "PDF reconhecido pelo cabeçalho");
  igual(tipoDoDocumento(bytes("\n\n  %PDF-1.4"))?.extensao, ".pdf", "PDF com lixo antes do cabeçalho ainda é PDF");
  igual(tipoDoDocumento(bytes([0xff, 0xd8, 0xff, 0xe0]))?.mime, "image/jpeg", "JPEG pela assinatura");
  igual(tipoDoDocumento(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime, "image/png", "PNG pela assinatura");
  igual(tipoDoDocumento(bytes("RIFF\0\0\0\0WEBPVP8 "))?.mime, "image/webp", "WebP pela assinatura");
  igual(tipoDoDocumento(bytes("\0\0\0\x18ftypheic"))?.mime, "image/heic", "HEIC do iPhone pela marca");
  igual(tipoDoDocumento(bytes("PK\x03\x04....[Content_Types].xml....word/document.xml", 128))?.extensao, ".docx", "Word novo: ZIP com word/");
  igual(tipoDoDocumento(bytes("PK\x03\x04....[Content_Types].xml....xl/workbook.xml", 128))?.extensao, ".xlsx", "Excel novo: ZIP com xl/");
  confere(tipoDoDocumento(bytes("PK\x03\x04....qualquer/coisa.txt", 128)) === null, "ZIP comum não é documento");
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  igual(tipoDoDocumento(bytes(ole), "application/vnd.ms-excel planilha.xls")?.extensao, ".xls", "Office antigo: a dica desempata para Excel");
  igual(tipoDoDocumento(bytes(ole), "application/msword")?.extensao, ".doc", "Office antigo sem dica de Excel: Word");
  confere(tipoDoDocumento(bytes("<!doctype html><script>alert(1)</script>"), "application/pdf contrato.pdf") === null, "HTML declarado como PDF é recusado");
  confere(tipoDoDocumento(bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="x()">')) === null, "SVG é recusado");
  confere(tipoDoDocumento(bytes("MZ\x90\0\x03")) === null, "executável é recusado");
  confere(tipoDoDocumento(new Uint8Array(4)) === null, "arquivo de 4 bytes é recusado");

  igual(mascarar("Vinicius.Lima@gmail.com"), "V***@gmail.com", "e-mail no log: primeira letra e domínio");
  igual(mascarar("123.456.789-09"), "CPF final 09", "CPF no log: só os dois últimos dígitos");
  igual(mascarar("12345678909"), "CPF final 09", "CPF sem pontuação: igual");
  confere(!mascarar("a@b.com\nlinha forjada").includes("\n"), "identificador com quebra de linha não forja linha de log");

  const provisoria = gerarSenhaProvisoria();
  confere(provisoria.length === 10 && /^[a-km-zA-HJ-NP-Z2-9]+$/.test(provisoria) && !/[01lIO]/.test(provisoria), "senha provisória: 10 caracteres, sem 0/O/1/l/I");
}

/** O segundo fator: os vetores de teste da própria RFC, a janela de tempo, o código que só vale uma vez e o segredo cifrado. */
{
  // RFC 4648 §10: base32("foobar") = MZXW6YTBOI======
  igual(base32Codificar(Buffer.from("foobar")), "MZXW6YTBOI", "Base32: 'foobar' (sem o preenchimento)");
  igual(base32Decodificar("mzxw 6ytb-oi")?.toString(), "foobar", "Base32 aceita minúsculas, espaço e hífen (digitado à mão)");
  confere(base32Decodificar("MZXW1") === null && base32Decodificar("") === null, "Base32 recusa letra fora do alfabeto e texto vazio");

  // RFC 6238, apêndice B (SHA-1, segredo "12345678901234567890"): os códigos de 8 dígitos terminam nos de 6.
  const rfc = Buffer.from("12345678901234567890");
  igual(base32Codificar(rfc), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "segredo da RFC em Base32");
  const vetores: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];
  for (const [segundos, esperado] of vetores) {
    igual(codigoDoPasso(rfc, passoDe(segundos * 1000)), esperado, `TOTP da RFC no instante ${segundos}`);
  }

  const segredo = novoSegredo();
  confere(/^[A-Z2-7]{32}$/.test(segredo), "segredo novo: 32 letras Base32 (160 bits)");
  const t0 = 1_900_000_000_000;
  const buf = base32Decodificar(segredo)!;
  const doPasso = (p: number) => codigoDoPasso(buf, p);
  const agora = passoDe(t0);
  igual(verificarCodigo(segredo, doPasso(agora), null, t0), agora, "código do passo atual confere");
  igual(verificarCodigo(segredo, doPasso(agora - 1), null, t0), agora - 1, "código do passo anterior confere (relógio do celular atrasado)");
  igual(verificarCodigo(segredo, doPasso(agora + 1), null, t0), agora + 1, "código do passo seguinte confere (relógio adiantado)");
  confere(verificarCodigo(segredo, doPasso(agora - 2), null, t0) === null, "código de 2 passos atrás (60 s+) não confere");
  confere(verificarCodigo(segredo, doPasso(agora + 2), null, t0) === null, "código de 2 passos à frente não confere");
  confere(verificarCodigo(segredo, doPasso(agora), agora, t0) === null, "o mesmo código não entra duas vezes (replay)");
  confere(verificarCodigo(segredo, doPasso(agora), agora - 1, t0) === agora, "código mais novo que o último aceito passa");
  confere(verificarCodigo(segredo, doPasso(agora - 1), agora, t0) === null, "código mais velho que o último aceito não passa");
  igual(verificarCodigo(segredo, `${doPasso(agora).slice(0, 3)} ${doPasso(agora).slice(3)}`, null, t0), agora, "aceita '123 456', como o aplicativo mostra");
  confere(verificarCodigo(segredo, "12345", null, t0) === null && verificarCodigo(segredo, "1234567", null, t0) === null, "5 ou 7 dígitos: recusado");
  confere(verificarCodigo(segredo, "abcdef", null, t0) === null && verificarCodigo(segredo, "", null, t0) === null, "letras ou vazio: recusado");
  confere(verificarCodigo("não é base32!", "123456", null, t0) === null, "segredo ilegível: recusado");

  const uri = enderecoOtpauth("GEZDGNBVGY3TQOJQ", "ana@empresa.com.br");
  confere(uri.startsWith("otpauth://totp/Selebi%3Aana%40empresa.com.br?") && uri.includes("secret=GEZDGNBVGY3TQOJQ") && uri.includes("issuer=Selebi") && uri.includes("digits=6") && uri.includes("period=30"), "endereço otpauth do QR");

  // O segredo guardado no banco: cifrado, amarrado ao dono.
  const chaveAntes = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "chave-so-de-teste-com-mais-de-16";
  confere(podeCifrarSegredo(), "com APP_ENCRYPTION_KEY, o segredo pode ser cifrado");
  const guardado = cifrarSegredo(segredo, "usuario-a");
  confere(!guardado.includes(segredo) && guardado.startsWith("v1."), "o texto guardado não contém o segredo");
  igual(abrirSegredo(guardado, "usuario-a"), segredo, "abre com a chave e o dono certos");
  confere(abrirSegredo(guardado, "usuario-b") === null, "segredo de um usuário colado na linha de outro não abre");
  confere(abrirSegredo(guardado.slice(0, -2) + "AA", "usuario-a") === null, "texto cifrado adulterado não abre");
  confere(cifrarSegredo(segredo, "usuario-a") !== guardado, "cada cifra usa um IV novo");
  process.env.APP_ENCRYPTION_KEY = "outra-chave-de-teste-com-16+";
  confere(abrirSegredo(guardado, "usuario-a") === null, "com a chave trocada o segredo não abre (e o painel oferece redefinir)");
  delete process.env.APP_ENCRYPTION_KEY;
  confere(!podeCifrarSegredo() && !mfaAtivo(), "sem APP_ENCRYPTION_KEY o 2FA fica desligado (e avisa), em vez de trancar todo mundo");
  process.env.APP_ENCRYPTION_KEY = "chave-so-de-teste-com-mais-de-16";
  confere(mfaAtivo(), "com a chave, o 2FA do navegador liga");
  process.env.MFA_MODO = "desligado";
  confere(!mfaAtivo(), "MFA_MODO=desligado desliga de propósito");
  delete process.env.MFA_MODO;
  confere(!mfaAtivoNoApp(), "no app, o 2FA só liga com MFA_APP=1");
  process.env.MFA_APP = "1";
  confere(mfaAtivoNoApp(), "MFA_APP=1 liga o 2FA no app");
  delete process.env.MFA_APP;
  if (chaveAntes === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = chaveAntes;

  igual(rotuloDoDispositivo("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 Edg/125.0"), "Edge · Windows", "rótulo do aparelho: Edge no Windows");
  igual(rotuloDoDispositivo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari · iPhone", "rótulo do aparelho: Safari no iPhone");
  igual(rotuloDoDispositivo(null), "Navegador · sistema desconhecido", "rótulo sem User-Agent");
}

/** O hash de senha: custo novo, formato antigo aceito e regravado, e o tempo igual para conta que não existe. */
async function testarSenha(): Promise<void> {
  const ATUAL = { N: 2 ** 15, r: 8, p: 3 };
  const hash = await gerarHash("Telhado-Norte-42");
  igual(hash.split("$").length, 6, "hash novo: scrypt$N$r$p$salt$chave");
  igual(JSON.stringify(custoDoHash(hash)), JSON.stringify(ATUAL), "hash novo com o custo de hoje (N=2^15, r=8, p=3)");
  const certa = await verificarSenha("Telhado-Norte-42", hash);
  confere(certa.confere && certa.novoHash === null, "senha certa confere, e hash atual não é regravado");
  confere(!(await verificarSenha("telhado-norte-42", hash)).confere, "senha errada não confere");
  confere(await conferirSenha("Telhado-Norte-42", hash), "conferirSenha continua valendo para quem só quer sim/não");

  // Uma conta de antes desta mudança: `scrypt$salt$chave`, custo padrão do Node.
  const sal = randomBytes(16);
  const antigo = `scrypt$${sal.toString("base64")}$${scryptSync("Telhado-Norte-42", sal, 64).toString("base64")}`;
  igual(JSON.stringify(custoDoHash(antigo)), JSON.stringify({ N: 2 ** 14, r: 8, p: 1 }), "hash antigo é lido como N=2^14, p=1");
  const migrada = await verificarSenha("Telhado-Norte-42", antigo);
  confere(migrada.confere && migrada.novoHash !== null, "hash antigo: a senha confere e vem um hash novo para gravar");
  igual(JSON.stringify(custoDoHash(migrada.novoHash ?? "")), JSON.stringify(ATUAL), "o hash regravado tem o custo de hoje");
  confere(await conferirSenha("Telhado-Norte-42", migrada.novoHash ?? ""), "a mesma senha confere contra o hash regravado");
  const erradaNoAntigo = await verificarSenha("outra-senha", antigo);
  confere(!erradaNoAntigo.confere && erradaNoAntigo.novoHash === null, "hash antigo com senha errada: não confere e nada é regravado");

  // A conta que não existe: o hash falso tem de ser lido e custar o mesmo que um de verdade.
  igual(JSON.stringify(custoDoHash(HASH_FANTASMA)), JSON.stringify(ATUAL), "hash fantasma é legível e tem o custo de hoje");
  const antes = performance.now();
  const fantasma = await verificarSenha("qualquer-coisa", HASH_FANTASMA);
  const gastou = performance.now() - antes;
  confere(!fantasma.confere && fantasma.novoHash === null, "hash fantasma nunca confere");
  confere(gastou > 30, `conta inexistente gasta o tempo do scrypt (${Math.round(gastou)} ms), e não 0 ms`);

  confere(!(await conferirSenha("x", "scrypt$lixo$lixo")), "hash corrompido não confere");
  confere(!(await conferirSenha("x", "scrypt$1073741824$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64"))), "custo absurdo gravado no banco é recusado, não executado");
  confere(!(await conferirSenha("a".repeat(5000), hash)), "senha de 5.000 caracteres é recusada");
}


// --- Contrato gerado pelo Selebi --------------------------------------------------
igual(inteiroPorExtenso(1), "um", "1 por extenso");
igual(inteiroPorExtenso(100), "cem", "100 é cem");
igual(inteiroPorExtenso(101), "cento e um", "101 é cento e um");
igual(inteiroPorExtenso(1000), "mil", "1000 é mil, sem 'um'");
igual(inteiroPorExtenso(1500), "mil e quinhentos", "mil e quinhentos");
igual(inteiroPorExtenso(1230), "mil duzentos e trinta", "mil duzentos e trinta (sem 'e' depois do mil)");
igual(inteiroPorExtenso(2030), "dois mil e trinta", "dois mil e trinta");
igual(inteiroPorExtenso(1_000_000), "um milhão", "um milhão");
igual(inteiroPorExtenso(2_500_000), "dois milhões e quinhentos mil", "dois milhões e quinhentos mil");
igual(reaisPorExtenso(50000), "cinquenta mil reais", "R$ 50.000,00 por extenso (o do modelo)");
igual(reaisPorExtenso(18500.5), "dezoito mil e quinhentos reais e cinquenta centavos", "reais e centavos");
igual(reaisPorExtenso(1), "um real", "um real, no singular");
igual(reaisPorExtenso(1_000_000), "um milhão de reais", "milhão redondo leva 'de reais'");
igual(reaisPorExtenso(0.01), "um centavo", "só centavos");

const entradaOk: EntradaContrato = {
  cliente: {
    nome: "Ana Maria Lima",
    tipo: "pf",
    cpfCnpj: "52998224725",
    logradouro: "Rua das Flores",
    numero: "62",
    complemento: "Apto 802",
    bairro: "Centro",
    cidade: "Itabaiana",
    uf: "SE",
    cep: "49500000",
  },
  projeto: {
    equipamentos: "2 inversores Growatt 10K, 40 módulos 625W / estrutura fibrocimento.",
    valor: "50000.00",
    formaPagamento: "cartao",
    pagamentoCondicoes: "6x (seis vezes) sem juros",
  },
  empresa: {
    nome: "Empresa Exemplo",
    razaoSocial: "Empresa Exemplo Ltda",
    cnpj: "11222333000181",
    endereco: "Av. Principal, 100, Centro, Itabaiana - SE, CEP 49500-000",
    email: "contato@exemplo.com.br",
  },
  representante: { nome: "Fulano de Tal", cpf: null },
};
igual(faltaParaContrato(entradaOk).length, 0, "contrato completo: nada falta");
const semDados = faltaParaContrato({
  ...entradaOk,
  cliente: { ...entradaOk.cliente, cpfCnpj: null, cep: "4950", numero: "" },
  projeto: { ...entradaOk.projeto, valor: null, formaPagamento: null },
  empresa: { ...entradaOk.empresa, razaoSocial: null },
  representante: null,
});
confere(semDados.includes("CPF do cliente"), "sem CPF: avisa o CPF");
confere(semDados.includes("CEP") && semDados.includes("número da casa"), "CEP pela metade e número vazio: avisa os dois");
confere(semDados.includes("valor total") && semDados.includes("forma de pagamento"), "sem valor e sem forma: avisa os dois");
confere(semDados.includes("quem assina pela empresa"), "sem representante: avisa");
igual(JSON.stringify(faltaDaEmpresa(semDados)), JSON.stringify(["razão social da empresa"]), "separa o que é da empresa");
confere(
  faltaParaContrato({ ...entradaOk, cliente: { ...entradaOk.cliente, tipo: "pj", cpfCnpj: "52998224725" } }).includes("CNPJ do cliente"),
  "cliente PJ com CPF no lugar do CNPJ: avisa o CNPJ",
);

const montado = montarContrato(entradaOk, new Date("2026-11-13T12:00:00Z"));
igual(
  montado.contratante.qualificacao,
  "brasileiro(a), inscrito(a) no CPF sob o nº 529.982.247-25",
  "qualificação do contratante como no modelo",
);
igual(
  montado.contratante.endereco,
  "Rua das Flores nº 62, Apto 802 - Centro, Itabaiana/SE, CEP 49500-000",
  "endereço do contratante como no modelo",
);
igual(montado.contratado.cnpj, "11.222.333/0001-81", "CNPJ da empresa formatado");
igual(montado.equipamentos, "2 inversores Growatt 10K, 40 módulos 625W / estrutura fibrocimento", "ponto final do kit sai (o PDF põe o dele)");
igual(
  montado.pagamento,
  "O(a) CONTRATANTE efetuará o pagamento de R$ 50.000,00 (cinquenta mil reais), cartão de crédito: 6x (seis vezes) sem juros.",
  "cláusula do pagamento com valor, extenso, forma e condições",
);
igual(
  fraseDoPagamento(18500.5, "a_vista", null),
  "O(a) CONTRATANTE efetuará o pagamento de R$ 18.500,50 (dezoito mil e quinhentos reais e cinquenta centavos), à vista (PIX ou transferência).",
  "pagamento sem condições",
);
const msgContrato = mensagemDoContrato({ cliente: "ANA MARIA LIMA", empresa: "Empresa Exemplo", link: "https://x/r/c/abc" });
confere(msgContrato.startsWith("Olá, Ana!") && msgContrato.includes("https://x/r/c/abc"), "mensagem do contrato com o primeiro nome e o link");
igual(nomeDoContrato(montado), "Contrato - Ana Maria Lima.pdf", "nome do arquivo do contrato");

// Documento entregue: "falta assinar" não conta para quem exige assinatura.
const entreguesTeste = tiposEntregues(
  [
    { tipo: "contrato", status: "aguardando_assinatura" },
    { tipo: "memorial", status: "trabalho" },
    { tipo: "documento_pessoal", status: "indefinido" },
    { tipo: "orcamento", status: "aguardando_assinatura" },
  ],
  new Set(["contrato", "memorial"]),
);
confere(!entreguesTeste.has("contrato"), "contrato ainda por assinar não conta como entregue");
confere(!entreguesTeste.has("memorial"), "arquivo de trabalho não conta");
confere(entreguesTeste.has("documento_pessoal"), "documento indefinido conta");
confere(entreguesTeste.has("orcamento"), "'falta assinar' em tipo que não exige assinatura conta");


// --- Catálogo de equipamentos: o kit em palavras -----------------------------------
const inversorTeste = { tipo: "inversor", fabricante: "Growatt", modelo: "MIN 10000TL-X", potenciaW: "10000.00" };
const moduloTeste = { tipo: "modulo", fabricante: "Jinko", modelo: "Tiger Neo", potenciaW: "625.00" };
igual(potenciaLegivel("10000.00", "inversor"), "10 kW", "inversor em kW");
igual(potenciaLegivel("625.00", "modulo"), "625 W", "módulo em W");
igual(potenciaLegivel(null, "modulo"), null, "sem potência, nada");
igual(rotuloDoModelo(inversorTeste), "Growatt MIN 10000TL-X (10 kW)", "rótulo do inversor na lista");
igual(
  textoDoKit({ inversor: inversorTeste, inversorQtd: 2, modulo: moduloTeste, moduloQtd: 40 }),
  "2 inversores Growatt MIN 10000TL-X, 40 módulos fotovoltaicos Jinko Tiger Neo 625W",
  "kit completo vira o texto do contrato",
);
igual(
  textoDoKit({ inversor: { ...inversorTeste, tipo: "microinversor" }, inversorQtd: 1, modulo: null, moduloQtd: null }),
  "1 microinversor Growatt MIN 10000TL-X",
  "um microinversor, no singular",
);
igual(textoDoKit({ inversor: null, inversorQtd: null, modulo: null, moduloQtd: null }), null, "sem kit, sem texto");


// --- Vistoria: o que o sistema aproveita das respostas ----------------------------
const respostasVistoria = [
  { chave: "uc_numero", valor: "  3004 5678  " },
  { chave: "titular_nome", valor: "Maria  das Dores Souza" },
  { chave: "telhado_tipo", valor: "Fibrocimento" },
  { chave: "disjuntor_amperagem", valor: 50 },
  { chave: null, valor: "item sem chave" },
];
const lida = lerVistoria(respostasVistoria);
igual(lida.ucNumero, "3004 5678", "UC: espaços sobrando saem");
igual(lida.titular, "Maria das Dores Souza", "titular: espaço duplo vira um");
igual(lida.telhado, "Fibrocimento", "telhado reconhecido");
const vazia = lerVistoria([
  { chave: "uc_numero", valor: "-" },
  { chave: "titular_nome", valor: "   " },
  { chave: "telhado_tipo", valor: "Sapê" },
]);
igual(vazia.ucNumero, null, "UC de 1 caractere não conta");
igual(vazia.titular, null, "titular em branco não conta");
igual(vazia.telhado, null, "telhado que não é opção não conta");
igual(lerVistoria([{ chave: "uc_numero", valor: 123456 }]).ucNumero, "123456", "UC que o banco devolve como número vale como texto");
igual(lerVistoria([{ chave: "uc_numero", valor: 1.5 }]).ucNumero, null, "número quebrado não é UC");
igual(lerVistoria([{ chave: "uc_numero", valor: true }]).ucNumero, null, "resposta de tipo inesperado não preenche");
igual(lerVistoria([]).telhado, null, "vistoria sem resposta nenhuma");
igual(estruturaDoTelhado("Fibrocimento"), "estrutura fibrocimento", "fibrocimento como no contrato do modelo");
igual(estruturaDoTelhado("Laje"), "estrutura para laje", "laje");
igual(estruturaDoTelhado("Outro"), null, "'Outro' não diz nada");
igual(estruturaDoTelhado(null), null, "sem telhado, sem estrutura");
confere(OPCOES_DE_TELHADO.length === 6, "as seis opções do item de telhado da vistoria");
igual(
  textoDoKit({ inversor: inversorTeste, inversorQtd: 2, modulo: moduloTeste, moduloQtd: 40, estrutura: "estrutura fibrocimento" }),
  "2 inversores Growatt MIN 10000TL-X, 40 módulos fotovoltaicos Jinko Tiger Neo 625W / estrutura fibrocimento",
  "kit + telhado: o objeto do contrato completo, como no modelo",
);
const projetoTeste = { equipamentos: null, inversorModeloId: "i1", inversorQtd: 2, moduloModeloId: "m1", moduloQtd: 40, telhadoTipo: "Fibrocimento" };
const catalogoTeste = [{ ...inversorTeste, id: "i1" }, { ...moduloTeste, id: "m1" }];
igual(
  sugestaoDeEquipamentos(projetoTeste, catalogoTeste),
  "2 inversores Growatt MIN 10000TL-X, 40 módulos fotovoltaicos Jinko Tiger Neo 625W / estrutura fibrocimento",
  "sugestão do contrato sem texto digitado",
);
igual(
  sugestaoDeEquipamentos({ ...projetoTeste, equipamentos: "o que o comercial digitou" }, catalogoTeste),
  "o que o comercial digitou",
  "texto digitado vale mais que a sugestão",
);
igual(sugestaoDeEquipamentos({ ...projetoTeste, inversorModeloId: null, moduloModeloId: null }, catalogoTeste), null, "sem kit, sem sugestão");


// --- Pedir os dados do cliente pelo WhatsApp ---------------------------------------
const clienteCompleto = { tipo: "pf" as const, cpfCnpj: "52998224725", logradouro: "Rua A", numero: "10", bairro: "Centro", cep: "49500000" };
igual(dadosDoClienteQueFaltam(clienteCompleto).length, 0, "cliente completo: nada a pedir");
igual(
  JSON.stringify(dadosDoClienteQueFaltam({ ...clienteCompleto, cpfCnpj: null })),
  JSON.stringify(["cpf"]),
  "sem CPF: pede só o CPF",
);
igual(
  JSON.stringify(dadosDoClienteQueFaltam({ ...clienteCompleto, cpfCnpj: "123", cep: "4950", numero: " " })),
  JSON.stringify(["cpf", "cep", "endereco"]),
  "CPF curto, CEP pela metade e número vazio: pede os três",
);
confere(dadosDoClienteQueFaltam({ ...clienteCompleto, tipo: "pj" }).includes("cpf"), "empresa com 11 dígitos no lugar do CNPJ: pede o CNPJ");
igual(rotuloDoPedidoDeDados(["cpf"]), "Cobrar CPF no WhatsApp", "botão quando só o CPF falta");
igual(rotuloDoPedidoDeDados(["cpf"], true), "Cobrar CNPJ no WhatsApp", "botão para empresa");
igual(rotuloDoPedidoDeDados(["cpf", "cep"]), "Pedir dados no WhatsApp", "botão quando falta mais de um");
const pedido = mensagemDeDadosDoCliente({ cliente: "ANA MARIA LIMA", empresa: "Empresa Exemplo", faltam: ["cpf", "endereco"] });
confere(pedido.startsWith("Olá, Ana!") && pedido.includes("• o seu CPF") && pedido.includes("rua, número e bairro"), "mensagem pede só o que falta");
confere(!pedido.includes("CEP"), "mensagem não pede o que já tem");

// --- Dados técnicos da vistoria ------------------------------------------------------
const respostasTecnicas = [
  { chave: "disjuntor_amperagem", valor: 50 },
  { chave: "disjuntor_polos", valor: "Bipolar" },
  { chave: "cabo_bitola", valor: "10 mm²" },
  { chave: "aterramento", valor: "Existe e está bom" },
  { chave: "qdg_vagas", valor: 4 },
  { chave: "rasgar_parede", valor: false },
  { chave: "telhado_tipo", valor: "Cerâmica" },
  { chave: "telhado_estado", valor: ["Bom", "Telhas quebradas"] },
  { chave: "area_util", valor: 42.5 },
  { chave: "inversor_local", valor: 12 },
  { chave: "ampliacao", valor: true },
];
const tecnicos = lerDadosTecnicos(respostasTecnicas);
igual(tecnicos.disjuntorA, 50, "disjuntor em ampères");
igual(tecnicos.polos, "Bipolar", "polos");
igual(tecnicos.areaUtilM2, 42.5, "área útil com casa decimal");
igual(tecnicos.rasgarParede, false, "'Não' é resposta, e não falta de resposta");
igual(JSON.stringify(tecnicos.telhadoEstado), JSON.stringify(["Bom", "Telhas quebradas"]), "estado do telhado em lista");
igual(tecnicos.inversorLocal, "12", "local do inversor que o banco devolveu como número volta como texto");
igual(faltaParaOProjeto(tecnicos).length, 0, "vistoria completa: o engenheiro pode começar");
const incompletos = faltaParaOProjeto(
  lerDadosTecnicos([
    { chave: "disjuntor_amperagem", valor: 50 },
    { chave: "cabo_bitola", valor: "Não deu para ver" },
    { chave: "area_util", valor: null },
  ]),
);
confere(incompletos.includes("bitola do cabo de entrada"), "bitola 'Não deu para ver' conta como falta");
confere(incompletos.includes("área útil do telhado") && incompletos.includes("polos do disjuntor"), "o que ficou em branco conta como falta");
confere(!incompletos.includes("amperagem do disjuntor"), "o que veio não conta como falta");
igual(faltaParaOProjeto(lerDadosTecnicos([])).length, 8, "sem nenhuma resposta, faltam os 8 essenciais");


// --- Tempo desde a assinatura do contrato ---------------------------------------------
const agoraTeste = new Date("2026-11-13T15:00:00Z");
igual(diasCorridos(new Date("2026-11-13T09:00:00Z"), agoraTeste), 0, "assinou hoje: 0 dias");
igual(diasCorridos(new Date("2026-11-12T16:00:00Z"), agoraTeste), 0, "menos de 24 h ainda é hoje");
igual(diasCorridos(new Date("2026-11-12T15:00:00Z"), agoraTeste), 1, "24 h exatas: 1 dia");
igual(diasCorridos(new Date("2026-11-01T15:00:00Z"), agoraTeste), 12, "12 dias");
igual(diasCorridos(new Date("2026-11-20T15:00:00Z"), agoraTeste), 0, "data no futuro não dá dia negativo");
igual(rotuloDoTempo(0), "hoje", "rótulo de hoje");
igual(rotuloDoTempo(12), "12 d", "rótulo curto do cartão");
igual(fraseDoTempo(1), "há 1 dia", "frase no singular");
igual(fraseDoTempo(12), "há 12 dias", "frase no plural");


// --- Distribuidora pela cidade (Sergipe tem Energisa e Sulgipe) -----------------------
igual(distribuidoraDaCidade("Itabaiana"), "Energisa Sergipe", "Itabaiana é Energisa");
igual(distribuidoraDaCidade("Lagarto"), "Energisa Sergipe", "Lagarto é Energisa");
igual(distribuidoraDaCidade("Itabaianinha"), "Sulgipe", "Itabaianinha é Sulgipe (não confundir com Itabaiana)");
igual(distribuidoraDaCidade("ESTÂNCIA"), "Sulgipe", "Estância, em maiúscula e com acento, é Sulgipe");
igual(distribuidoraDaCidade("Umbaúba - SE"), "Sulgipe", "cidade com '- SE' no fim");
igual(distribuidoraDaCidade(null), "Energisa Sergipe", "sem cidade, Energisa");

// --- Envio do projeto à Energisa -------------------------------------------------------
{
  const vazio = conferirEnvio(new Set());
  confere(
    ["Documento do titular", "Conta de luz da geradora", "ART", "Projeto elétrico", "Memorial", "Datasheet e Inmetro"].every((r) =>
      vazio.faltam.includes(r),
    ),
    "sem nada na pasta, faltam os 6 documentos obrigatórios do pedido",
  );
  confere(!vazio.faltam.includes("Procuração"), "procuração é condicional: não conta como falta");
  const cheio = conferirEnvio(new Set(["documento_pessoal", "uc_geradora", "art", "projeto_eletrico", "memorial", "datasheet"]));
  igual(cheio.faltam.length, 0, "com os 6 na pasta, nada falta");
  confere(cheio.itens.find((i) => i.tipo === "art")?.tem === true, "o item diz que a ART está na pasta");

  igual(lerNumeroDoPortal(" 1236226 "), "1236226", "número do portal com espaço");
  igual(lerNumeroDoPortal("ID 1.236.226"), "1236226", "número do portal com pontos e texto fica só com os dígitos");
  igual(lerNumeroDoPortal("12"), null, "número curto demais não vale");
  igual(lerNumeroDoPortal(1236226), null, "só texto do formulário vale");

  const campos = dadosParaOPortal({
    cliente: {
      nome: "Maria da Silva",
      cpfCnpj: "12345678901",
      telefone: "(79) 99999-1234",
      email: null,
      cep: "49500000",
      logradouro: "Rua A",
      numero: "10",
      complemento: "",
      bairro: "Centro",
      cidade: "Itabaiana",
      uf: "se",
    },
    uc: { numero: "3001234567", titular: "José da Silva", concessionaria: "Energisa Sergipe" },
    distribuidora: "Energisa Sergipe",
    potenciaKwp: null,
    inversor: { fabricante: "Growatt", modelo: "MIN 4200TL-X", potenciaW: "4200" },
    inversorQtd: null,
    modulo: { fabricante: "Jinko", modelo: "Tiger Neo", potenciaW: 585 },
    moduloQtd: 7,
    telhado: "Cerâmica",
    numeroArt: null,
  });
  const valor = (chave: string) => campos.find((c) => c.chave === chave)?.valor;
  igual(valor("titular"), "José da Silva", "o titular é o da conta de luz, não o cliente");
  igual(valor("cpf_cnpj"), "123.456.789-01", "CPF com pontos e traço");
  igual(valor("cep"), "49500-000", "CEP com traço");
  igual(valor("uf"), "SE", "UF em maiúscula");
  igual(valor("potencia_kwp"), "4,095", "sem potência no projeto, sai dos módulos (7 × 585 W)");
  igual(valor("inversor_qtd"), "1", "inversor sem quantidade conta como 1");
  igual(valor("inversor_kw"), "4,2", "potência do inversor em kW");
  igual(valor("complemento"), undefined, "campo em branco não entra no painel");
  igual(valor("art"), undefined, "ART sem número não entra");
}

/** O PDF do contrato sai de verdade, com e sem logo. */
async function testarContratoPdf(): Promise<void> {
  const logo =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  for (const comLogo of [null, logo]) {
    const pdf = await gerarContratoPdf(montado, comLogo);
    const texto = pdf.subarray(0, 8).toString("latin1");
    confere(texto.startsWith("%PDF-"), `contrato em PDF ${comLogo ? "com" : "sem"} logo`);
    const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    confere(paginas >= 2 && paginas <= 4, `contrato ${comLogo ? "com" : "sem"} logo tem de 2 a 4 páginas (${paginas})`);
    if (process.env.CONTRATO_AMOSTRA && comLogo === null) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.CONTRATO_AMOSTRA, pdf);
    }
  }
}

testarRetrace()
  .then(testarSenha)
  .then(testarContratoPdf)
  .then(() => {
    console.log(falhas === 0 ? `✓ ${total} conferências, nenhuma falha.` : `✗ ${falhas} de ${total} falharam.`);
    process.exit(falhas === 0 ? 0 : 1);
  });
