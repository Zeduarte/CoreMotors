// Popup da extensão: autorizar o site do backoffice e ver a conta do Facebook.
const $ = (id) => document.getElementById(id);

async function origins() {
  const { origins } = await chrome.storage.local.get("origins");
  return Array.isArray(origins) ? origins : [];
}
async function save(list) {
  await chrome.storage.local.set({ origins: [...new Set(list)] });
}

function el(tag, props = {}, children = []) {
  const e = Object.assign(document.createElement(tag), props);
  for (const c of children) e.append(c);
  return e;
}

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let origin = null;
  let path = "";
  try {
    const u = new URL(tab && tab.url ? tab.url : "");
    if (u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) {
      origin = u.origin;
      path = u.pathname;
    }
  } catch {}

  const list = await origins();
  const site = $("site");
  site.replaceChildren();
  if (!origin) {
    site.append(el("p", { className: "muted", textContent: "Abra o separador Partilhas do backoffice e clique outra vez neste ícone para autorizar o site." }));
  } else if (list.includes(origin)) {
    site.append(el("p", {}, ["Este site está autorizado: ", el("code", { textContent: origin })]));
  } else {
    site.append(el("p", {}, ["Autorizar ", el("code", { textContent: origin }), " a usar a extensão?"]));
    if (!path.startsWith("/admin"))
      site.append(el("p", { className: "muted", textContent: "Atenção: esta página não é do backoffice (/admin). Autorize só o site do seu backoffice." }));
    const btn = el("button", { className: "primary", textContent: "Autorizar este site" });
    btn.addEventListener("click", async () => {
      await save([...(await origins()), origin]);
      render();
    });
    site.append(btn);
  }

  const ul = $("list");
  ul.replaceChildren();
  if (!list.length) ul.append(el("li", { className: "muted", textContent: "Nenhum." }));
  for (const o of list) {
    const rm = el("button", { textContent: "Remover" });
    rm.addEventListener("click", async () => {
      await save((await origins()).filter((x) => x !== o));
      render();
    });
    ul.append(el("li", {}, [el("span", { textContent: o, title: o }), rm]));
  }

  const read = async (name) => {
    try {
      const c = await chrome.cookies.get({ url: "https://www.facebook.com", name });
      return c && /^\d+$/.test(c.value) ? c.value : null;
    } catch {
      return null;
    }
  };
  const fb = (await read("i_user")) || (await read("c_user"));
  $("fb").textContent = fb ? `Sessão iniciada (conta ${fb}).` : "Sem sessão. Inicie sessão em facebook.com.";
}

render();
