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
import { lerDsn, montarEnvelope } from "../sistema/sentry";
import { tipoReal } from "./tipo-arquivo";

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

console.log(falhas === 0 ? `✓ ${total} conferências, nenhuma falha.` : `✗ ${falhas} de ${total} falharam.`);
process.exit(falhas === 0 ? 0 : 1);
