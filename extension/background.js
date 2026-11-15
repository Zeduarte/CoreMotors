// Service worker da extensão «CoreMotors Partilhas».
//
// Recebe os pedidos da página Partilhas (pela ponte, bridge.js) e faz o
// trabalho numa janela própria do Chrome, com a sessão do Facebook de quem a
// usa: ler a lista de grupos e partilhar um anúncio num grupo. A lógica de
// cada página do Facebook está em fb-page.js, injetado em cada carregamento.
//
// Segurança:
//  - Só obedece a sites autorizados no popup («Autorizar este site»); a origem
//    vem do Chrome (sender.origin), não do que a página diz.
//  - Só abre endereços do Facebook.
//  - Do Facebook só lê o id da conta (cookies c_user/i_user), nunca a sessão.

const FB = "https://www.facebook.com";
const GROUPS_URL = "https://www.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added";
const VERSION = chrome.runtime.getManifest().version;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isFacebookUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && /(^|\.)facebook\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

async function allowedOrigins() {
  const { origins } = await chrome.storage.local.get("origins");
  return Array.isArray(origins) ? origins : [];
}

/** A conta do Facebook aberta neste Chrome (a agir como perfil/página: i_user). */
async function fbUserId() {
  const read = async (name) => {
    try {
      const c = await chrome.cookies.get({ url: FB, name });
      return c && /^\d{1,30}$/.test(c.value) ? c.value : null;
    } catch {
      return null;
    }
  };
  return (await read("i_user")) || (await read("c_user"));
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

let job = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (err) =>
    sendResponse({ ok: false, error: String((err && err.message) || err || "Erro desconhecido.") }),
  );
  return true; // resposta assíncrona
});

async function handle(msg, sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab) return { ok: false, error: "Pedido recusado." };
  let origin = sender.origin;
  if (!origin && sender.url) origin = new URL(sender.url).origin;
  const paired = !!origin && (await allowedOrigins()).includes(origin);

  if (msg && msg.type === "hello")
    return { ok: true, result: { version: VERSION, paired, fbUserId: paired ? await fbUserId() : null } };
  if (!paired) return { ok: false, code: "not_paired", error: "Este site não está autorizado na extensão." };
  if (job) return { ok: false, error: "A extensão já está a meio de outro pedido. Espere que termine." };

  job = msg.type;
  try {
    if (msg.type === "readGroups") return { ok: true, result: await readGroups() };
    if (msg.type === "share") return { ok: true, result: await share(msg.payload || {}) };
    return { ok: false, error: "Pedido desconhecido." };
  } finally {
    job = null;
  }
}

// ---------------------------------------------------------------------------
// A janela de trabalho
// ---------------------------------------------------------------------------

let work = null; // { tabId, windowId }

function waitComplete(tabId, { checkNow }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(resolve), 45000); // segue mesmo sem «complete»
    function done(fn, arg) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      fn(arg);
    }
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") done(resolve);
    }
    function onRemoved(id) {
      if (id === tabId) done(reject, new Error("A janela do Facebook foi fechada."));
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    if (checkNow)
      chrome.tabs
        .get(tabId)
        .then((t) => {
          if (t.status === "complete" && !t.pendingUrl && isFacebookUrl(t.url || "")) done(resolve);
        })
        .catch(() => done(reject, new Error("A janela do Facebook foi fechada.")));
  });
}

/** Abre `url` na janela de trabalho (cria-a na primeira vez) e espera que carregue. */
async function openWork(url) {
  if (!isFacebookUrl(url)) throw new Error("Só se abrem endereços do Facebook.");
  if (work) {
    try {
      await chrome.tabs.get(work.tabId);
      const loaded = waitComplete(work.tabId, { checkNow: false });
      await chrome.tabs.update(work.tabId, { url });
      await loaded;
      return work.tabId;
    } catch {
      work = null;
    }
  }
  const win = await chrome.windows.create({ url, focused: true, width: 1280, height: 900 });
  work = { tabId: win.tabs[0].id, windowId: win.id };
  await waitComplete(work.tabId, { checkNow: true });
  return work.tabId;
}

chrome.tabs.onRemoved.addListener((id) => {
  if (work && work.tabId === id) work = null;
});

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["fb-page.js"] });
}

async function call(tabId, fn, args = []) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (fn, args) => {
      try {
        return await window.__cmPartilhas[fn](...args);
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
    },
    args: [fn, args],
  });
  return (res && res.result) || { error: "A página do Facebook não respondeu." };
}

// ---------------------------------------------------------------------------
// Trabalhos
// ---------------------------------------------------------------------------

async function readGroups() {
  const id = await fbUserId();
  if (!id) throw new Error("Este Chrome não tem sessão no Facebook. Inicie sessão em facebook.com e tente de novo.");
  const tabId = await openWork(GROUPS_URL);
  await sleep(2000);
  await inject(tabId);
  const r = await call(tabId, "scanGroups");
  if (r.error) throw new Error(r.error);
  if (!r.groups || !r.groups.length)
    throw new Error("Não encontrei grupos na página do Facebook. Confirme que a lista de grupos abre e tente de novo.");
  if ((await fbUserId()) !== id) throw new Error("A conta do Facebook mudou durante a leitura. Nada foi gravado.");
  return { fbUserId: id, groups: r.groups };
}

const STATUSES = new Set(["confirmed", "pending", "uncertain", "rate_limited", "failed", "attention"]);

async function share({ adUrl, groupName }) {
  if (!isFacebookUrl(adUrl)) return { status: "failed", reason: "O link do anúncio não é do Facebook.", stop: true };
  if (typeof groupName !== "string" || !groupName.trim())
    return { status: "failed", reason: "Grupo sem nome.", stop: false };
  if (!(await fbUserId()))
    return { status: "attention", reason: "Este Chrome não tem sessão no Facebook. Inicie sessão e volte a tentar.", stop: true };

  for (let attempt = 0; attempt < 2; attempt++) {
    const tabId = await openWork(adUrl);
    await sleep(2500);
    await inject(tabId);
    const r = await call(tabId, "shareToGroup", [groupName.trim()]);
    if (r.retry && attempt === 0) continue;
    if (r.error) return { status: "failed", reason: `Não submetido: ${r.error}`, stop: true };
    return {
      status: STATUSES.has(r.status) ? r.status : "uncertain",
      reason: String(r.reason || "").slice(0, 1000),
      stop: !!r.stop,
    };
  }
  return { status: "failed", reason: "Não submetido: o botão Publicar não apareceu.", stop: false };
}
