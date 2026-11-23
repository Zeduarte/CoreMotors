// Ponte entre o separador Partilhas do backoffice e a extensão.
//
// Corre nas páginas /admin… (o Next muda de página sem recarregar, por isso não
// basta /admin/partilhas). Não faz nada sozinha: só passa à extensão os pedidos
// que a página manda por window.postMessage, e devolve as respostas. É o
// service worker que decide se este site está autorizado (sender.origin).
(() => {
  const PAGE = "coremotors-partilhas-page";
  const EXT = "coremotors-partilhas-ext";
  const TYPES = new Set(["hello", "readGroups", "share", "searchGroups", "joinGroup", "setSchedules"]);

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== PAGE || typeof data.id !== "string" || !TYPES.has(data.type)) return;
    const reply = (body) => window.postMessage({ source: EXT, id: data.id, ...body }, location.origin);
    try {
      chrome.runtime.sendMessage({ type: data.type, payload: data.payload }, (response) => {
        if (chrome.runtime.lastError) {
          reply({ ok: false, error: "A extensão foi atualizada ou desligada. Recarregue esta página." });
          return;
        }
        reply(response || { ok: false, error: "A extensão não respondeu." });
      });
    } catch {
      reply({ ok: false, error: "A extensão foi atualizada ou desligada. Recarregue esta página." });
    }
  });
})();
