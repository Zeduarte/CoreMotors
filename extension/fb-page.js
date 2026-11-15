// Injetado nas páginas do Facebook pela extensão: lê a lista de grupos e faz
// a partilha de um anúncio num grupo, com os cliques que uma pessoa faria.
//
// O Facebook muda a interface sem aviso. Quando um passo não é reconhecido,
// pára e diz porquê; nunca afirma que publicou sem ver a confirmação, e nunca
// tenta contornar verificações, limites ou a aprovação dos administradores.
(() => {
  if (window.__cmPartilhas) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLocaleLowerCase("pt-PT")
      .replace(/\s+/g, " ")
      .trim();
  /** Só letras e números: os emojis e a pontuação não contam para comparar nomes. */
  const key = (s) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();

  const CLICKABLE =
    'button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"],[role="radio"],[role="link"],a[href],[role="listitem"],[role="row"],[role="gridcell"],[role="checkbox"],[tabindex="0"]';

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) !== 0;
  }
  const text = (el) => (el.innerText || el.textContent || "").replace(/[ \t]+/g, " ").trim();
  const firstLine = (el) => text(el).split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
  const label = (el) => (el.getAttribute("aria-label") || firstLine(el)).trim();
  const clickables = (root) => [...(root || document).querySelectorAll(CLICKABLE)].filter(isVisible);
  const bodyText = () => ((document.body && document.body.innerText) || "").toLocaleLowerCase("pt-PT");
  const area = (el) => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  };

  function topDialog() {
    const all = [...document.querySelectorAll('[role="dialog"]')].filter(isVisible);
    return all[all.length - 1] || null;
  }

  async function waitFor(fn, ms = 20000, step = 250) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  function isEnabled(el) {
    return !el.disabled && el.getAttribute("aria-disabled") !== "true";
  }

  function click(el) {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerover", { ...base, pointerType: "mouse" }));
    el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse", buttons: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseup", base));
    el.dispatchEvent(new MouseEvent("click", base));
  }

  function typeInto(el, value) {
    el.focus();
    if (el.isContentEditable) {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, value);
      return;
    }
    if (typeof el.select === "function") el.select();
    const ok = document.execCommand("insertText", false, value);
    if (!ok || el.value !== value) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  // ---- Situações em que se pára -------------------------------------------

  const LIMIT =
    /we limit how often you can (post|comment|do other things)|we limit how often.{0,120}(post|comment)|limitamos a frequ[eê]ncia.{0,160}(publicar|comentar|publica[cç][oõ]es)|limite tempor[aá]rio.{0,100}(publica[cç][oõ]es|publicar|comentar)|you('|’)re temporarily blocked|est[aá]s temporariamente bloquead/i;
  const CHECK =
    /captcha|security check|verifica[cç][aã]o de seguran[cç]a|confirm that you.?re human|confirma que [ée]s uma pessoa|two-factor|autentica[cç][aã]o de dois fatores|c[oó]digo de confirma[cç][aã]o/i;
  const postingLimit = () => LIMIT.test(bodyText());
  const needsCheck = () => CHECK.test(bodyText());
  function loggedOut() {
    if (/\/(login|checkpoint|recover)/i.test(location.pathname)) return true;
    return !!document.querySelector('input[name="pass"]') && !!document.querySelector('input[name="email"]');
  }
  const LIMIT_REASON =
    "O Facebook limitou temporariamente a frequência de publicações. A fila parou: espere até o Facebook voltar a permitir e verifique este grupo antes de tentar de novo.";

  // ---- Ler a lista de grupos ------------------------------------------------

  const GENERIC = new Set([
    "groups", "grupos", "view group", "ver grupo", "visitar grupo", "see more", "ver mais", "choose a group",
    "selecionar grupo", "escolher grupo", "search groups", "pesquisar grupos", "partilhar num grupo",
    "share to a group", "publicar", "partilhar", "share", "post", "cancelar", "cancel", "close", "fechar",
  ]);

  function cleanGroupName(value) {
    const line = String(value || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || "";
    if (line.length < 2 || line.length > 200) return "";
    if (GENERIC.has(line.toLocaleLowerCase("pt-PT"))) return "";
    if (/^(search|pesquisar|choose|selecionar|create post|criar publica|última atividade|ultima atividade|last active|you last visited|visitaste)/i.test(line))
      return "";
    return line;
  }

  async function scanGroups() {
    if (loggedOut()) return { error: "O Facebook pediu para iniciar sessão. Inicie sessão e tente de novo." };
    if (needsCheck()) return { error: "O Facebook pediu uma verificação. Conclua-a na janela do Facebook e tente de novo." };
    await waitFor(() => document.querySelector('[role="main"] a[href*="/groups/"]'), 20000);

    const found = new Map();
    let stable = 0;
    let lastHeight = 0;
    for (let round = 0; round < 150; round++) {
      const before = found.size;
      const main = document.querySelector('[role="main"]') || document.body;
      for (const a of main.querySelectorAll('a[href*="/groups/"]')) {
        if (!isVisible(a)) continue;
        let u;
        try {
          u = new URL(a.href);
        } catch {
          continue;
        }
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts[0] !== "groups" || parts.length !== 2) continue;
        if (["joins", "discover", "create", "feed"].includes(parts[1])) continue;
        if (found.has(parts[1])) continue;
        const name = cleanGroupName(a.getAttribute("aria-label") || a.innerText || a.textContent);
        if (name) found.set(parts[1], { key: parts[1], name, url: `https://www.facebook.com/groups/${parts[1]}/` });
      }

      // Desce na lista (o Facebook vai carregando mais grupos ao fazer scroll).
      const scroller = (() => {
        const all = [document.scrollingElement, ...main.querySelectorAll("*")].filter(Boolean);
        const candidates = all.filter((el) => {
          const pageScroller = el === document.scrollingElement;
          const oy = getComputedStyle(el).overflowY;
          return el.scrollHeight > el.clientHeight + 80 && el.clientHeight > 100 && (pageScroller || oy === "auto" || oy === "scroll");
        });
        candidates.sort((x, y) => y.querySelectorAll('a[href*="/groups/"]').length - x.querySelectorAll('a[href*="/groups/"]').length);
        return candidates[0] || document.scrollingElement;
      })();
      const top = scroller.scrollTop;
      scroller.scrollTop = Math.min(top + Math.max(400, scroller.clientHeight * 0.85), scroller.scrollHeight);
      await sleep(800);
      const height = scroller.scrollHeight;
      const moved = scroller.scrollTop > top || height > lastHeight;
      lastHeight = height;
      if (found.size === before && !moved) stable++;
      else stable = 0;
      if (stable >= 4) break;
    }
    return { groups: [...found.values()] };
  }

  // ---- Partilhar num grupo ----------------------------------------------------

  const SHARE = /^(share|partilhar|compartilhar)$/i;
  const GROUP_OPTION =
    /^(share to a group|share in a group|share to group|partilhar num grupo|partilhar no grupo|partilhar em grupo|partilhar num grupo de que fazes parte|group|groups|grupo|grupos)$/i;
  const POST = /^(post|publicar|partilhar|share|publicar agora|share now|partilhar agora)$/i;

  function findShareButton() {
    const scope = document.querySelector('[role="main"]') || document;
    let c = clickables(scope).filter((el) => SHARE.test(label(el)));
    if (!c.length) c = clickables(document).filter((el) => SHARE.test(label(el)));
    if (!c.length) c = clickables(scope).filter((el) => /\b(share|partilhar)\b/i.test(el.getAttribute("aria-label") || ""));
    return c[0] || null;
  }

  function findGroupOption() {
    const els = clickables(document).filter((el) => GROUP_OPTION.test(label(el)) || GROUP_OPTION.test(firstLine(el)));
    if (els.length) return els.sort((a, b) => area(a) - area(b))[0];
    const leaves = [...document.querySelectorAll("span,div")].filter(
      (el) => el.childElementCount === 0 && isVisible(el) && GROUP_OPTION.test(text(el)),
    );
    for (const leaf of leaves) {
      const c = leaf.closest(CLICKABLE);
      if (c && isVisible(c)) return c;
    }
    return null;
  }

  function findSearch(scope) {
    const sel =
      'input[type="search"],input[placeholder],input[aria-label],[role="combobox"],[role="searchbox"],[contenteditable="true"][role="textbox"]';
    const all = [...scope.querySelectorAll(sel)].filter(isVisible);
    const re = /pesquis|procur|search|find|grupo|group/i;
    return (
      all.find((el) => re.test(`${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""}`)) ||
      all.find((el) => el.matches('input[type="search"],[role="searchbox"]')) ||
      null
    );
  }

  /** O resultado da pesquisa com o nome do grupo: igual, ou a começar igual. */
  function findGroupResult(scope, wanted) {
    const k = key(wanted);
    let best = null;
    let bestScore = 0;
    for (const el of clickables(scope)) {
      if (el.matches('input,[role="combobox"],[role="searchbox"],[role="textbox"]')) continue;
      const lines = text(el).split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 2);
      for (const option of [el.getAttribute("aria-label") || "", ...lines]) {
        const ok = key(option);
        if (!ok) continue;
        const score = ok === k ? 3 : ok.length >= 8 && (ok.startsWith(k) || k.startsWith(ok)) ? 2 : 0;
        if (score > bestScore || (score === bestScore && score > 0 && best && area(el) < area(best))) {
          best = el;
          bestScore = score;
        }
      }
    }
    return bestScore >= 2 ? best : null;
  }

  function findPostButton() {
    const dialog = topDialog();
    if (!dialog) return null;
    const c = clickables(dialog).filter((el) => POST.test(label(el)) && isEnabled(el));
    return c[c.length - 1] || null;
  }

  const CONFIRMED = /partilhad[oa] n[oa] grupo|publicad[oa] n[oa] grupo|shared to (the )?group|shared successfully|your post is now (in the group|live)|a tua publica[cç][aã]o (foi partilhada|est[aá] no grupo)|publica[cç][aã]o foi partilhada/i;
  const PENDING = /pendente.{0,40}aprova|aguarda.{0,40}aprova|pending.{0,40}approval|awaiting approval|submitted for (admin )?approval|enviad[ao] para aprova/i;
  const count = (re, s) => (s.match(new RegExp(re.source, "gi")) || []).length;
  // Os avisos curtos do Facebook (o «toast» depois de publicar): aqui pode
  // procurar-se por palavras largas sem apanhar o resto da página.
  const TOAST = /partilhad[oa]|publicad[oa]|shared|posted/i;
  const toastText = () =>
    [...document.querySelectorAll('[role="alert"],[role="status"],[aria-live="polite"],[aria-live="assertive"]')]
      .filter(isVisible)
      .map((el) => text(el))
      .join(" | ");

  async function shareToGroup(groupName) {
    if (loggedOut()) return { status: "attention", reason: "A sessão do Facebook não está iniciada neste Chrome.", stop: true };
    if (postingLimit()) return { status: "rate_limited", reason: `${LIMIT_REASON} Este grupo ainda não foi submetido.`, stop: true };
    if (needsCheck()) return { status: "attention", reason: "O Facebook pediu uma verificação. Conclua-a na janela do Facebook.", stop: true };

    // 1. «Partilhar» no anúncio.
    const shareBtn = await waitFor(findShareButton, 30000);
    if (!shareBtn)
      return { status: "failed", reason: "Não encontrei o botão Partilhar no anúncio. Confirme que o link abre o anúncio.", stop: true };
    click(shareBtn);

    // 2. «Partilhar num grupo».
    const option = await waitFor(findGroupOption, 20000);
    if (!option) return { status: "failed", reason: "Depois de Partilhar, não encontrei a opção «Grupo».", stop: true };
    click(option);
    if (needsCheck()) return { status: "attention", reason: "O Facebook pediu uma verificação. Nada foi publicado.", stop: true };

    // 3. Pesquisar e escolher o grupo.
    await waitFor(topDialog, 15000);
    let search = await waitFor(() => findSearch(topDialog() || document), 15000);
    if (!search) {
      const chooser = clickables(topDialog() || document).find((el) =>
        /selecionar grupo|escolher grupo|select group|choose group/i.test(label(el)),
      );
      if (chooser) {
        click(chooser);
        search = await waitFor(() => findSearch(topDialog() || document), 15000);
      }
    }
    if (!search) return { status: "failed", reason: "Abri a escolha do grupo, mas não encontrei o campo de pesquisa.", stop: true };

    const queries = [groupName];
    const short = groupName.replace(/[^\p{L}\p{N}\s&-]/gu, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
    if (short && short !== groupName) queries.push(short);
    let result = null;
    for (const q of queries) {
      typeInto(search, q);
      result = await waitFor(() => findGroupResult(topDialog() || document, groupName), 12000, 400);
      if (result) break;
    }
    if (!result)
      return {
        status: "failed",
        reason: `Não encontrei o grupo «${groupName}» na escolha do Facebook. Não foi submetido; a fila segue para o próximo.`,
        stop: false,
      };
    click(result);

    // 4. «Publicar».
    const post = await waitFor(findPostButton, 20000, 300);
    if (!post)
      return { retry: true, status: "failed", reason: "Escolhi o grupo, mas o botão Publicar não apareceu. Não foi submetido.", stop: false };
    if (postingLimit()) return { status: "rate_limited", reason: `${LIMIT_REASON} Este grupo ainda não foi submetido.`, stop: true };

    const baseline = bodyText();
    const before = { ok: count(CONFIRMED, baseline), pending: count(PENDING, baseline), toast: toastText() };
    click(post);

    // 5. O que o Facebook respondeu (até 45 s).
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      await sleep(1500);
      if (postingLimit())
        return {
          status: "rate_limited",
          reason: "O Facebook mostrou o limite de publicações depois de carregar em Publicar. O resultado deste grupo é incerto; verifique-o antes de tentar de novo. A fila parou.",
          stop: true,
        };
      if (needsCheck()) return { status: "uncertain", reason: "O Facebook pediu uma verificação depois de Publicar. Verifique este grupo.", stop: true };
      const now = bodyText();
      if (count(PENDING, now) > before.pending)
        return { status: "pending", reason: "Submetido para aprovação dos administradores do grupo.", stop: false };
      if (count(CONFIRMED, now) > before.ok) return { status: "confirmed", reason: "Confirmação vista no Facebook.", stop: false };
      const toast = toastText();
      if (toast !== before.toast && TOAST.test(toast) && !PENDING.test(toast))
        return { status: "confirmed", reason: `Confirmação vista no Facebook: «${toast.slice(0, 120)}»`, stop: false };
    }
    return {
      status: "uncertain",
      reason: "Carreguei em Publicar, mas não vi a confirmação do Facebook. Verifique este grupo antes de voltar a tentar. A fila parou.",
      stop: true,
    };
  }

  window.__cmPartilhas = { scanGroups, shareToGroup };
})();
