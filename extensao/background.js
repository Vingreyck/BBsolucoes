// Selebi — Energisa
//
// A cada 30 minutos, na aba do portal da Energisa que alguém abriu e entrou,
// pede a mesma lista "Meus projetos" que a página mostra e entrega ao Selebi.
// Não entra no portal, não digita nada, não abre o portal sozinha: quando ele
// sai da conta, avisa a pessoa e espera ela entrar de novo.
//
// Envio de projeto (2.2): quando o engenheiro clica "Abrir o painel no portal"
// no dossiê, mostra na aba do portal um painel com os dados e os documentos do
// projeto, para ele copiar no formulário. Quem envia é ele, pelo botão do
// portal; a extensão não clica em nada lá.

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
chrome.tabs.onUpdated.addListener((id, mudou, aba) => {
  // A aba do portal recarregou ou a pessoa acabou de entrar: o painel do envio volta.
  if (mudou.status !== "complete" || !aba.url?.startsWith(`${PORTAL}/AWGPE/`)) return;
  envioPendente().then((p) => p && mostrarPainel(id, p.dados));
});
chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.tipo === "fechar-painel" && sender.url?.startsWith(`${PORTAL}/`)) {
    chrome.storage.session.remove("envio");
    return;
  }
  if (msg?.tipo !== "preencher-energisa" || !sender.url?.startsWith(`${SELEBI}/`)) return;
  prepararEnvio(String(msg.projetoId ?? "")).then(responder, (e) =>
    responder({ estado: "erro", texto: `Falhou: ${e?.message ?? e}` }),
  );
  return true; // resposta assíncrona
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

// --- Envio de projeto: o painel ao lado do formulário do portal ---------------------

const PAINEL_DURA = 3 * 60 * 60_000;

async function prepararEnvio(projetoId) {
  if (!/^[0-9a-f-]{36}$/i.test(projetoId)) return { estado: "erro", texto: "Projeto inválido." };
  let r;
  try {
    r = await fetch(`${SELEBI}/api/energisa/envio/${projetoId}`, {
      credentials: "include",
      cache: "no-store",
      headers: { "X-Selebi-Extensao": chrome.runtime.getManifest().version },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { estado: "erro", texto: `O Selebi não respondeu (${e?.message ?? e}).` };
  }
  const dados = await r.json().catch(() => null);
  if (!r.ok || !dados?.ok) return { estado: "erro", texto: dados?.erro ?? `O Selebi respondeu ${r.status}.` };
  await chrome.storage.session.set({ envio: { dados, ate: Date.now() + PAINEL_DURA } });

  const aba = await abaDoPortal();
  if (!aba) {
    // Abre porque a pessoa clicou; entrar (CPF e SMS) continua sendo com ela.
    await chrome.tabs.create({ url: PAINEL, active: true });
    return {
      estado: "aguardando",
      texto: "Abri o portal da Energisa numa aba nova. Entre com o CPF e o código do SMS: o painel do Selebi aparece sozinho.",
    };
  }
  await chrome.tabs.update(aba.id, { active: true });
  await chrome.windows.update(aba.windowId, { focused: true });
  if (!aba.url?.includes("/AWGPE/")) {
    return {
      estado: "aguardando",
      texto: "O portal está aberto, mas fora da área de projetos ou fora da conta. Entre: o painel aparece sozinho.",
    };
  }
  return (await mostrarPainel(aba.id, dados))
    ? {
        estado: "ok",
        texto: `Painel de ${dados.cliente} aberto na aba do portal. Envie pelo portal e volte aqui com o número.`,
      }
    : { estado: "erro", texto: "Não consegui mostrar o painel no portal. Recarregue a aba do portal (F5) e tente de novo." };
}

async function envioPendente() {
  const { envio } = await chrome.storage.session.get("envio");
  return envio && envio.ate > Date.now() ? envio : null;
}

async function mostrarPainel(tabId, dados) {
  try {
    const [r] = await comPrazo(
      chrome.scripting.executeScript({ target: { tabId }, func: painelNoPortal, args: [dados] }),
      15_000,
    );
    return r?.result === true;
  } catch {
    return false;
  }
}

// Roda dentro da aba do portal (mundo isolado). Só desenha um painel por cima
// da página, num shadow root: não mexe no formulário deles. Tudo por
// textContent, nada de HTML montado com os dados.
function painelNoPortal(dados) {
  const ID = "selebi-painel-envio";
  document.getElementById(ID)?.remove();
  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;";
  const raiz = host.attachShadow({ mode: "closed" });

  const el = (tag, classe, texto) => {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined) n.textContent = texto;
    return n;
  };
  const seguro = (url) => (typeof url === "string" && /^https:\/\//.test(url) ? url : null);
  const copiar = async (valor, botao) => {
    try {
      await navigator.clipboard.writeText(valor);
    } catch {
      const t = document.createElement("textarea");
      t.value = valor;
      t.style.cssText = "position:fixed;opacity:0;";
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    botao.textContent = "copiado";
    setTimeout(() => (botao.textContent = "copiar"), 1500);
  };

  const estilo = el("style");
  estilo.textContent = `
    :host { all: initial; }
    .p { width: 340px; max-height: calc(100vh - 24px); display: flex; flex-direction: column; background: #fff; color: #1f2329;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; border: 1px solid #d9dde3; border-radius: 12px;
      box-shadow: 0 14px 28px -6px rgba(17,20,24,.25); overflow: hidden; }
    .topo { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #b4501a; color: #fff; }
    .topo strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .topo button { all: unset; cursor: pointer; padding: 0 6px; font-size: 16px; line-height: 1; }
    .corpo { overflow: auto; padding: 10px 12px 12px; }
    .p.min .corpo { display: none; }
    .nota { margin: 0 0 10px; color: #5b6470; }
    h3 { margin: 12px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #5b6470; }
    .linha { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; border-bottom: 1px dashed #e7e9ed; }
    .rot { width: 118px; flex-shrink: 0; color: #5b6470; }
    .val { flex: 1; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
    .linha button, .linha a { all: unset; cursor: pointer; color: #b4501a; font-size: 12px; flex-shrink: 0; }
    .linha button:hover, .linha a:hover { text-decoration: underline; }
    .falta { color: #a16207; font-size: 12px; flex-shrink: 0; }
    .fim { display: block; margin-top: 12px; color: #b4501a; font-weight: 600; }
  `;

  const painel = el("div", "p");
  const topo = el("div", "topo");
  topo.append(el("strong", "", `Selebi · ${dados.cliente ?? ""}`));
  const minimizar = el("button", "", "–");
  minimizar.title = "Recolher";
  minimizar.onclick = () => painel.classList.toggle("min");
  const fechar = el("button", "", "×");
  fechar.title = "Fechar o painel";
  fechar.onclick = () => {
    host.remove();
    chrome.runtime.sendMessage({ tipo: "fechar-painel" }).catch(() => undefined);
  };
  topo.append(minimizar, fechar);

  const corpo = el("div", "corpo");
  corpo.append(
    el("p", "nota", "Copie cada dado para o formulário e anexe os documentos. O envio é você quem faz, pelo botão do portal."),
  );

  corpo.append(el("h3", "", "Dados"));
  for (const c of Array.isArray(dados.campos) ? dados.campos : []) {
    const linha = el("div", "linha");
    const botao = el("button", "", "copiar");
    botao.onclick = () => copiar(String(c.valor), botao);
    linha.append(el("span", "rot", String(c.rotulo)), el("span", "val", String(c.valor)), botao);
    corpo.append(linha);
  }

  corpo.append(el("h3", "", "Documentos"));
  for (const d of Array.isArray(dados.documentos) ? dados.documentos : []) {
    const linha = el("div", "linha");
    linha.append(el("span", "val", d.quando ? `${d.rotulo} (só ${d.quando})` : String(d.rotulo)));
    const url = seguro(d.baixar);
    if (url) {
      const a = el("a", "", "baixar");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      if (d.nome) a.title = String(d.nome);
      linha.append(a);
    } else if (!d.quando) linha.append(el("span", "falta", "falta no Selebi"));
    corpo.append(linha);
  }

  const dossie = seguro(dados.dossie);
  if (dossie) {
    const fim = el("a", "fim", "Enviou? Registre o número no Selebi →");
    fim.href = dossie;
    fim.target = "_blank";
    fim.rel = "noopener";
    corpo.append(fim);
  }

  painel.append(topo, corpo);
  raiz.append(estilo, painel);
  document.documentElement.appendChild(host);
  return true;
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
