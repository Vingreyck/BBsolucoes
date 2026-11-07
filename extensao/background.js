// Selebi — Energisa
//
// A cada 30 minutos, na aba do portal da Energisa que alguém abriu e entrou,
// pede a mesma lista "Meus projetos" que a página mostra e entrega ao Selebi.
// Não entra no portal, não digita nada, não abre o portal sozinha: quando ele
// sai da conta, avisa a pessoa e espera ela entrar de novo.

const SELEBI = "https://app.selebi.com.br";
const PORTAL = "https://servicos.energisa.com.br";
const PAINEL = `${PORTAL}/AWGPE/dashboard?CodigoEmpresaWeb=3`;
const ALARME = "ler-energisa";
const MINUTOS = 30;
const CHEIA_A_CADA = 6 * 60 * 60_000;
const CAMPOS = [
  "numeroProjetoEletrico",
  "nomeEmpreendimento",
  "descricaoLogradouro",
  "numeroEndereco",
  "nomeBairro",
  "codigoUF",
  "dataAberturaISO",
  "codigoSituacaoProjetoEletrico",
  "descricaoSituacaoProjetoEletrico",
];

const SITUACAO = {
  ok: { selo: "", cor: "#16a34a" },
  sem_aba: {
    selo: "–",
    cor: "#6b7280",
    aviso: "O portal da Energisa não está aberto. Clique aqui para abrir; entre e deixe a aba aberta.",
  },
  deslogado: {
    selo: "!",
    cor: "#dc2626",
    aviso: "O portal da Energisa saiu da conta. Clique aqui e entre de novo (CPF e código do SMS) — a atualização volta sozinha.",
  },
  sem_selebi: {
    selo: "!",
    cor: "#dc2626",
    aviso: "Este Chrome não está logado no Selebi com um usuário da gestão. Clique aqui para entrar.",
  },
  erro: {
    selo: "!",
    cor: "#d97706",
    aviso: "Não consegui ler o portal da Energisa. Recarregue a aba do portal (F5); se continuar, avise o suporte.",
  },
};

// Os ouvintes ficam no topo: o Chrome desliga o service worker quando está
// parado e o religa só para entregar estes eventos.
chrome.runtime.onInstalled.addListener(() => {
  garantirAlarme();
  atualizar("instalada");
});
chrome.runtime.onStartup.addListener(garantirAlarme);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARME) atualizar("alarme");
});
chrome.action.onClicked.addListener(() => atualizar("clique"));
chrome.tabs.onUpdated.addListener((_id, mudou, aba) => {
  // Alguém acabou de entrar no portal (ou recarregou o painel): não espera o alarme.
  if (mudou.status !== "complete" || !aba.url?.startsWith(`${PORTAL}/AWGPE/dashboard`)) return;
  ultimo().then((u) => {
    if (u.estado !== "ok" || Date.now() - (u.quando ?? 0) > 10 * 60_000) atualizar("portal-aberto");
  });
});
chrome.notifications.onClicked.addListener(abrirPeloAviso);
garantirAlarme();

// O Chrome pode apagar alarmes ao reiniciar: confere a cada vez que acorda.
async function garantirAlarme() {
  if (!(await chrome.alarms.get(ALARME))) {
    await chrome.alarms.create(ALARME, { delayInMinutes: 1, periodInMinutes: MINUTOS });
  }
}

let emCurso = null;
function atualizar(motivo) {
  emCurso ??= executar(motivo).finally(() => {
    emCurso = null;
  });
  return emCurso;
}

async function executar(motivo) {
  const antes = await ultimo();
  const aba = await abaDoPortal();
  if (!aba) return concluir("sem_aba", motivo);

  const leitura = await lerNaAba(aba);
  if (leitura.deslogado) {
    if (antes.estado !== "deslogado") await enviar({ estado: "portal_deslogado" }).catch(() => undefined);
    return concluir("deslogado", motivo);
  }
  if (!leitura.lista) return concluir("erro", motivo, leitura.erro);

  // Quase sempre a lista é a mesma de meia hora atrás: aí vai só um "nada
  // mudou" de poucos bytes, e o Selebi não regrava nada. A lista inteira vai
  // quando muda, no clique e, por garantia, a cada 6 horas.
  const marca = await impressao(leitura.lista);
  const cheia = motivo === "clique" || antes.marca !== marca || Date.now() - (antes.cheiaEm ?? 0) > CHEIA_A_CADA;
  let r = await mandar(cheia ? { lista: leitura.lista } : { estado: "sem_mudanca", total: leitura.lista.length });
  if (!cheia && r.estado === "erro") r = await mandar({ lista: leitura.lista });
  if (r.estado !== "ok") return concluir(r.estado, motivo, r.detalhe);

  if (r.corpo.mudaram || r.corpo.movidos?.length) notificar("mudancas", "Energisa: novidade nos projetos", r.corpo.texto);
  return concluir("ok", motivo, r.corpo.texto, { marca, ...(r.reenviou ? { cheiaEm: Date.now() } : {}) });
}

async function mandar(corpo) {
  let resposta;
  try {
    resposta = await enviar(corpo);
  } catch (e) {
    return { estado: "erro", detalhe: `o Selebi não respondeu (${e?.message ?? e})` };
  }
  if (resposta.status === 401 || resposta.status === 403) return { estado: "sem_selebi" };
  const dados = await resposta.json().catch(() => null);
  if (!dados?.ok) return { estado: "erro", detalhe: dados?.erro ?? `o Selebi respondeu ${resposta.status}` };
  return { estado: "ok", corpo: dados, reenviou: Array.isArray(corpo.lista) };
}

async function impressao(lista) {
  const resumo = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(lista)));
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A aba do sistema de projetos (AWGPE) primeiro; entre várias, a que não está suspensa.
async function abaDoPortal() {
  const abas = await chrome.tabs.query({ url: `${PORTAL}/*` });
  const nota = (a) => (a.url?.includes("/AWGPE/") ? 2 : 0) + (a.discarded ? 0 : 1);
  return abas.sort((a, b) => nota(b) - nota(a))[0] ?? null;
}

async function lerNaAba(aba) {
  try {
    // Com o Economizador de memória, o Chrome suspende abas paradas — e numa
    // aba suspensa a leitura trava sem erro. Esta não é suspensa mais.
    if (aba.autoDiscardable !== false) await chrome.tabs.update(aba.id, { autoDiscardable: false });
    if (aba.discarded || aba.frozen) {
      await chrome.tabs.reload(aba.id);
      await esperarCarregar(aba.id);
    }
    const [r] = await comPrazo(
      chrome.scripting.executeScript({ target: { tabId: aba.id }, func: lerNoPortal, args: [CAMPOS] }),
      60_000,
    );
    return r?.result ?? { erro: "a aba do portal não respondeu" };
  } catch (e) {
    return { erro: e?.message ?? String(e) };
  }
}

// Roda dentro da aba do portal (mundo isolado: enxerga o DOM, não as variáveis
// da página — por isso o build sai do <script id="__NEXT_DATA__">, e não de
// window.__NEXT_DATA__). Tem de ser autossuficiente: nada de fora entra aqui.
async function lerNoPortal(campos) {
  const emp = new URLSearchParams(location.search).get("CodigoEmpresaWeb") || "3";
  const dadosDe = (doc) => {
    try {
      return JSON.parse(doc.getElementById("__NEXT_DATA__")?.textContent || "null");
    } catch {
      return null;
    }
  };
  const listaDe = (pageProps) => {
    if (!pageProps) return null;
    if (pageProps.__N_REDIRECT || pageProps.dadosServerSide?.redirect) return { deslogado: true };
    const lista = pageProps.dadosServerSide?.solicitacao;
    if (!Array.isArray(lista)) return null;
    return {
      lista: lista.map((p) =>
        Object.fromEntries(Object.entries(p).filter(([k]) => campos.includes(k) || /^descricaoTipo/i.test(k))),
      ),
    };
  };
  const opcoes = { credentials: "include", cache: "no-store" };
  try {
    const build = dadosDe(document)?.buildId;
    if (build) {
      const r = await fetch(`/_next/data/${build}/AWGPE/dashboard.json?CodigoEmpresaWeb=${emp}`, opcoes);
      if (r.ok) {
        const v = listaDe((await r.json())?.pageProps);
        if (v) return v;
      }
    }
    // A Energisa publicou versão nova e o build desta aba não vale mais: a
    // página do painel traz a lista (e o build novo) no próprio HTML.
    const r = await fetch(`/AWGPE/dashboard?CodigoEmpresaWeb=${emp}`, opcoes);
    if (/\/(login|logout)/i.test(new URL(r.url).pathname)) return { deslogado: true };
    if (!r.ok) return { erro: `o portal respondeu ${r.status}` };
    const pagina = dadosDe(new DOMParser().parseFromString(await r.text(), "text/html"));
    return listaDe(pagina?.props?.pageProps) ?? { erro: "o portal respondeu sem a lista" };
  } catch (e) {
    return { erro: String(e?.message || e) };
  }
}

function enviar(corpo) {
  return fetch(`${SELEBI}/api/energisa/importar`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Selebi-Extensao": chrome.runtime.getManifest().version },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(60_000),
  });
}

async function concluir(estado, motivo, detalhe = "", leitura = {}) {
  const antes = await ultimo();
  const s = SITUACAO[estado];
  const agora = Date.now();
  const hora = new Date(agora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  await chrome.action.setBadgeText({ text: s.selo });
  await chrome.action.setBadgeBackgroundColor({ color: s.cor });
  await chrome.action.setTitle({
    title: `Selebi — Energisa · ${hora}\n${estado === "ok" ? detalhe : s.aviso}\n\nClique para atualizar agora.`,
  });

  // Problema avisa uma vez (não a cada 30 min) e só no expediente; o clique
  // na extensão sempre responde.
  let avisado = estado === "ok" ? null : antes.avisado;
  if (estado === "ok") {
    for (const id of Object.keys(SITUACAO)) chrome.notifications.clear(id);
    if (motivo === "clique") notificar("ok", "Selebi — Energisa", `Atualizado: ${detalhe}`);
  } else if (motivo === "clique" || (avisado !== estado && noExpediente())) {
    notificar(estado, "Selebi — Energisa", detalhe ? `${s.aviso}\n(${detalhe})` : s.aviso);
    avisado = estado;
  }
  const { marca, cheiaEm } = { ...antes, ...leitura };
  await chrome.storage.local.set({ ultimo: { estado, detalhe, quando: agora, avisado, marca, cheiaEm } });
}

async function ultimo() {
  return (await chrome.storage.local.get("ultimo")).ultimo ?? {};
}

function noExpediente() {
  const d = new Date();
  return d.getDay() >= 1 && d.getDay() <= 6 && d.getHours() >= 7 && d.getHours() < 19;
}

function notificar(id, titulo, texto) {
  chrome.notifications.create(id, { type: "basic", iconUrl: "icones/128.png", title: titulo, message: texto, priority: 1 });
}

async function abrirPeloAviso(id) {
  chrome.notifications.clear(id);
  if (id === "sem_selebi") return chrome.tabs.create({ url: `${SELEBI}/energisa` });
  if (id === "mudancas" || id === "ok") return chrome.tabs.create({ url: `${SELEBI}/esteira` });
  const aba = await abaDoPortal();
  if (!aba) return chrome.tabs.create({ url: PAINEL, pinned: true });
  await chrome.tabs.update(aba.id, { active: true });
  await chrome.windows.update(aba.windowId, { focused: true });
}

function esperarCarregar(tabId, ms = 45_000) {
  return new Promise((pronto) => {
    const prazo = setTimeout(sair, ms);
    function ouvir(id, mudou) {
      if (id === tabId && mudou.status === "complete") sair();
    }
    function sair() {
      clearTimeout(prazo);
      chrome.tabs.onUpdated.removeListener(ouvir);
      pronto();
    }
    chrome.tabs.onUpdated.addListener(ouvir);
  });
}

function comPrazo(promessa, ms) {
  return Promise.race([
    promessa,
    new Promise((_, falha) => setTimeout(() => falha(new Error("a aba demorou demais para responder")), ms)),
  ]);
}
