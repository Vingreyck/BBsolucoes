// Selebi — Energisa: a ponte entre as páginas do Selebi e a extensão.
//
// O botão "Abrir o painel no portal" do dossiê fala com a extensão por
// postMessage (a página não sabe o id da extensão). Este script só repassa o
// pedido ao service worker e devolve a resposta à página. Não lê nada do Selebi.

(() => {
  const versao = chrome.runtime.getManifest().version;
  const avisarPronta = () => window.postMessage({ tipo: "selebi:energisa-pronta", versao }, location.origin);

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (d?.tipo === "selebi:energisa-ping") return avisarPronta();
    if (d?.tipo !== "selebi:preencher-energisa" || typeof d.projetoId !== "string") return;

    const responder = (r) =>
      window.postMessage({ tipo: "selebi:energisa-resposta", pedido: d.pedido, ...r }, location.origin);
    try {
      chrome.runtime.sendMessage({ tipo: "preencher-energisa", projetoId: d.projetoId }, (r) => {
        if (chrome.runtime.lastError || !r) {
          responder({ estado: "erro", texto: "A extensão foi atualizada ou recarregada. Recarregue esta página (F5)." });
        } else responder(r);
      });
    } catch {
      responder({ estado: "erro", texto: "A extensão foi atualizada ou recarregada. Recarregue esta página (F5)." });
    }
  });

  avisarPronta();
})();
