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
import { montarAssertiva, montarMensagem } from "../push/fcm";
import { montarCorpoApns, montarJwtApns, tokenMorto } from "../push/apns";
import { quandoLegivel, textoDoAviso } from "../push/texto";
import { generateKeyPairSync, verify } from "node:crypto";

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

testarRetrace().then(() => {
  console.log(falhas === 0 ? `✓ ${total} conferências, nenhuma falha.` : `✗ ${falhas} de ${total} falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
});
