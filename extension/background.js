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
//  - Do Facebook só lê o id da conta (cookies c_user/i_user) e o nome dela,
//    nunca a sessão.

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
// O nome da conta do Facebook
// ---------------------------------------------------------------------------
//
// Para a página mostrar «Duarte Sll» em vez de um número. O Facebook põe o nome
// da conta aberta em «CurrentUserInitialData» nas suas páginas; lê-se uma vez
// (pedido com a sessão do próprio Chrome) e guarda-se, por id, durante 6 horas.
// Só o nome: nada da sessão sai do Chrome.

const NAME_TTL = 6 * 3600 * 1000;
let nameFetch = null;

async function cachedNames() {
  const { fbNames } = await chrome.storage.local.get("fbNames");
  return fbNames && typeof fbNames === "object" ? fbNames : {};
}

/** Tira o nome de uma página do Facebook, se for da conta `id`. */
function nameFromHtml(html, id) {
  const m = /"CurrentUserInitialData",\[\],\{[^}]*?"USER_ID":"(\d+)","NAME":"((?:[^"\\]|\\.)*)"/.exec(html || "");
  if (!m || m[1] !== id) return null;
  try {
    const name = JSON.parse(`"${m[2]}"`).replace(/\s+/g, " ").trim();
    return name ? name.slice(0, 120) : null;
  } catch {
    return null;
  }
}

function refreshName(id) {
  if (nameFetch || typeof fetch !== "function") return;
  nameFetch = (async () => {
    try {
      const html = await (await fetch(`${FB}/settings`, { credentials: "include" })).text();
      const name = nameFromHtml(html, id);
      if (name) {
        const names = await cachedNames();
        names[id] = { name, at: Date.now() };
        await chrome.storage.local.set({ fbNames: names });
      }
    } catch {
      // Sem rede ou o Facebook mudou: fica o id.
    } finally {
      nameFetch = null;
    }
  })();
}

/** A conta aberta (id e nome, se já se souber) e os nomes já vistos neste Chrome. */
async function whoIsOnFacebook() {
  const id = await fbUserId();
  const all = await cachedNames();
  const fbNames = {};
  for (const [k, v] of Object.entries(all)) if (v && typeof v.name === "string") fbNames[k] = v.name;
  const cached = id ? all[id] : null;
  if (id && (!cached || Date.now() - (cached.at || 0) > NAME_TTL)) refreshName(id);
  return { fbUserId: id, fbName: cached ? cached.name : null, fbNames };
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
    return { ok: true, result: { version: VERSION, paired, ...(paired ? await whoIsOnFacebook() : { fbUserId: null, fbName: null, fbNames: {} }) } };
  if (!paired) return { ok: false, code: "not_paired", error: "Este site não está autorizado na extensão." };
  // Os horários não usam o Facebook: respondem mesmo a meio de outro pedido.
  if (msg.type === "setSchedules") return { ok: true, result: await setSchedules(origin, msg.payload || {}) };
  if (job) return { ok: false, error: "A extensão já está a meio de outro pedido. Espere que termine." };

  job = msg.type;
  try {
    if (msg.type === "readGroups") return { ok: true, result: await readGroups() };
    if (msg.type === "share") return { ok: true, result: await share(msg.payload || {}) };
    if (msg.type === "searchGroups") return { ok: true, result: await searchGroups(msg.payload || {}) };
    if (msg.type === "joinGroup") return { ok: true, result: await joinGroup(msg.payload || {}) };
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
      await bringToFront();
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

/**
 * Põe a janela do Facebook à frente. Uma janela tapada ou minimizada é
 * abrandada pelo Chrome (temporizadores e pesquisa do Facebook muito
 * lentos), e a partilha ou a leitura dos grupos falham a meio.
 */
async function bringToFront() {
  if (!work) return;
  try {
    const win = await chrome.windows.get(work.windowId);
    if (win.state === "minimized") await chrome.windows.update(work.windowId, { state: "normal" });
    await chrome.windows.update(work.windowId, { focused: true });
    await chrome.tabs.update(work.tabId, { active: true });
  } catch {
    // A janela foi fechada: openWork cria outra.
  }
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
  await bringToFront();
  const r = await call(tabId, "scanGroups");
  if (r.error) throw new Error(r.error);
  if (!r.groups || !r.groups.length)
    throw new Error("Não encontrei grupos na página do Facebook. Confirme que a lista de grupos abre e tente de novo.");
  if ((await fbUserId()) !== id) throw new Error("A conta do Facebook mudou durante a leitura. Nada foi gravado.");
  return { fbUserId: id, groups: r.groups };
}

const STATUSES = new Set(["confirmed", "pending", "uncertain", "rate_limited", "failed", "attention"]);

async function share({ adUrl, groupName, groupUrl }) {
  if (!isFacebookUrl(adUrl)) return { status: "failed", reason: "O link do anúncio não é do Facebook.", stop: true };
  if (typeof groupName !== "string" || !groupName.trim())
    return { status: "failed", reason: "Grupo sem nome.", stop: false };
  if (!(await fbUserId()))
    return { status: "attention", reason: "Este Chrome não tem sessão no Facebook. Inicie sessão e volte a tentar.", stop: true };

  for (let attempt = 0; attempt < 2; attempt++) {
    const tabId = await openWork(adUrl);
    await sleep(2500);
    await inject(tabId);
    await bringToFront();
    const r = await call(tabId, "shareToGroup", [groupName.trim(), isFacebookUrl(groupUrl || "") ? groupUrl : null]);
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

// ---------------------------------------------------------------------------
// Procurar grupos e aderir
// ---------------------------------------------------------------------------

function searchUrl(query) {
  return `${FB}/search/groups/?q=${encodeURIComponent(query)}`;
}

function cleanQuery(value) {
  const q = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return q.length >= 2 && q.length <= 80 ? q : null;
}

async function searchGroups({ query, max }) {
  const q = cleanQuery(query);
  if (!q) throw new Error("Palavra-chave inválida.");
  const id = await fbUserId();
  if (!id) throw new Error("Este Chrome não tem sessão no Facebook. Inicie sessão em facebook.com e tente de novo.");
  const tabId = await openWork(searchUrl(q));
  await sleep(2500);
  await inject(tabId);
  await bringToFront();
  const r = await call(tabId, "scanSearch", [Math.max(1, Math.min(200, Number(max) || 30))]);
  if (r.error) throw new Error(r.error);
  return { fbUserId: id, groups: Array.isArray(r.groups) ? r.groups : [] };
}

const JOIN_STATUSES = new Set(["joined", "requested", "questions", "member", "limited", "failed"]);

async function joinGroup({ query, groupKey }) {
  const q = cleanQuery(query);
  if (!q || typeof groupKey !== "string" || !/^[\w.-]{1,220}$/.test(groupKey))
    return { status: "failed", reason: "Pedido inválido.", stop: false };
  if (!(await fbUserId())) return { status: "limited", reason: "Este Chrome não tem sessão no Facebook.", stop: true };
  const tabId = await openWork(searchUrl(q));
  await sleep(2500);
  await inject(tabId);
  await bringToFront();
  const r = await call(tabId, "joinFromSearch", [groupKey]);
  if (r.error) return { status: "failed", reason: `Não aderiu: ${r.error}`, stop: false };
  return {
    status: JOIN_STATUSES.has(r.status) ? r.status : "failed",
    reason: String(r.reason || "").slice(0, 1000),
    stop: !!r.stop,
  };
}

// ---------------------------------------------------------------------------
// Horários automáticos
// ---------------------------------------------------------------------------
//
// A página Partilhas manda os horários de cada conta (setSchedules). Um
// alarme de minuto a minuto vê se algum está na hora (hora de Lisboa) e abre
// a página Partilhas desse site com ?auto=<id>: é ela que faz o trabalho e o
// grava. Precisa do Chrome aberto; um horário que passou com o Chrome fechado
// ainda corre se o Chrome abrir até 2 horas depois.

const LATE_MINUTES = 120;

/** Dia da semana (0 = domingo), minutos do dia e data «AAAA-MM-DD», em Lisboa. */
function lisbonNow(date) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date))
    parts[p.type] = p.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute), day: `${parts.year}-${parts.month}-${parts.day}` };
}

/** O horário está na hora agora (e ainda não correu hoje)? */
function isDue(item, now, ranOn) {
  if (!item || !item.enabled || !Array.isArray(item.weekdays) || !item.weekdays.includes(now.weekday)) return false;
  const m = /^(\d{2}):(\d{2})$/.exec(item.at || "");
  if (!m) return false;
  const at = Number(m[1]) * 60 + Number(m[2]);
  return now.minutes >= at && now.minutes <= at + LATE_MINUTES && ranOn !== now.day;
}

function cleanSchedule(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && /^[0-9a-f-]{36}$/i.test(raw.id) ? raw.id : null;
  const at = typeof raw.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.at) ? raw.at : null;
  const weekdays = Array.isArray(raw.weekdays) ? raw.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  if (!id || !at || !weekdays.length) return null;
  return { id, at, weekdays, enabled: raw.enabled !== false };
}

async function setSchedules(origin, { accountId, items }) {
  if (typeof accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(accountId)) throw new Error("Conta inválida.");
  const list = (Array.isArray(items) ? items : []).map(cleanSchedule).filter(Boolean).slice(0, 50);
  const { schedules = {} } = await chrome.storage.local.get("schedules");
  if (list.length) schedules[accountId] = { origin, items: list };
  else delete schedules[accountId];
  await chrome.storage.local.set({ schedules });
  return { saved: list.length };
}

async function tick() {
  if (job) return;
  const { schedules = {}, ranOn = {} } = await chrome.storage.local.get(["schedules", "ranOn"]);
  const origins = await allowedOrigins();
  const now = lisbonNow(new Date());
  for (const [accountId, entry] of Object.entries(schedules)) {
    if (!entry || !origins.includes(entry.origin)) continue;
    for (const item of entry.items || []) {
      if (!isDue(item, now, ranOn[item.id])) continue;
      ranOn[item.id] = now.day;
      await chrome.storage.local.set({ ranOn });
      const url = `${entry.origin}/admin/partilhas?conta=${encodeURIComponent(accountId)}&auto=${encodeURIComponent(item.id)}`;
      await chrome.tabs.create({ url, active: true });
      return; // um de cada vez: o próximo no minuto seguinte
    }
  }
}

if (chrome.alarms) {
  chrome.alarms.create("cm-tick", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === "cm-tick") void tick();
  });
}
