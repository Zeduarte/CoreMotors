"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addManualGroups,
  archiveShareAd,
  createFbAccount,
  createShareAd,
  deleteFbAccount,
  recordShareAttempt,
  renameFbAccount,
  resetShareGroup,
  saveScannedGroups,
  setGroupInclude,
  setGroupsInclude,
  shareQuota,
  unbindFbAccount,
} from "@/lib/actions/fb-shares";
import {
  GROUP_CATEGORIES,
  GROUP_CATEGORY_LABEL,
  SHARE_DAILY_LIMIT,
  STATUS_LABEL,
  remainingShares,
  buildQueue,
  groupCategory,
  isIncluded,
  type GroupCategory,
  isBlocked,
  isOlderVersion,
  latestStatusByGroup,
  suggestExclusion,
  type ShareResultStatus,
} from "@/lib/fb-shares";
import {
  ExtensionError,
  extensionHello,
  extensionJoinGroup,
  extensionReadGroups,
  extensionSearchGroups,
  extensionSetSchedules,
  extensionShare,
  type JoinOneResult,
} from "@/lib/fb-extension";
import { bindAccountIfNew, joinQuota, markScheduleRun, recordGroupJoin } from "@/lib/actions/fb-discovery";
import {
  JOIN_COUNTED,
  JOIN_DAILY_LIMIT,
  JOIN_GAP_JITTER_SECONDS,
  JOIN_GAP_MIN_SECONDS,
  JOIN_STATUS_LABEL,
  cleanFoundGroups,
  describeSchedule,
  doneJoinKeys,
  matchesKeywords,
  pickJoinCandidates,
  remainingJoins,
  type FoundGroup,
} from "@/lib/fb-discovery";
import { DiscoverPanel, type FoundRow } from "@/components/admin/DiscoverPanel";
import { CategoriesSchedules } from "@/components/admin/CategoriesSchedules";
import type { ShareCarOption } from "@/lib/fb-shares-queries";
import type {
  FbAccountRow,
  FbCategoryRow,
  FbGroupJoinRow,
  FbGroupRow,
  FbJoinStatus,
  FbScheduleRow,
  FbShareAdRow,
  FbShareAttemptRow,
  FbShareStatus,
} from "@/lib/supabase/database.types";

type ExtState =
  | { state: "checking" }
  | { state: "missing" }
  | { state: "not_paired"; version: string }
  | { state: "ready"; version: string; fbUserId: string | null; fbName: string | null; fbNames: Record<string, string> };

interface LogLine {
  time: string;
  group: string;
  status: ShareResultStatus | "info";
  text: string;
  /** O nome do estado, quando não é o de uma partilha (ex.: «Pedido enviado»). */
  label?: string;
}

/** Os estados das adesões, nas cores dos estados das partilhas. */
const JOIN_LOG_STATUS: Record<FbJoinStatus, ShareResultStatus | "info"> = {
  joined: "confirmed",
  requested: "pending",
  questions: "uncertain",
  member: "info",
  limited: "rate_limited",
  failed: "failed",
};

type PanelTab = "share" | "discover" | "setup";

/** A data de hoje em Lisboa, «AAAA-MM-DD». */
const lisbonDay = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });

const STATUS_STYLE: Record<FbShareStatus | "attention" | "info", string> = {
  confirmed: "bg-emerald-500/15 text-emerald-300",
  pending: "bg-amber-500/15 text-amber-300",
  uncertain: "bg-amber-500/15 text-amber-300",
  rate_limited: "bg-red-500/15 text-red-300",
  failed: "bg-red-500/10 text-red-300/80",
  reset: "bg-white/10 text-paper/60",
  attention: "bg-red-500/15 text-red-300",
  info: "bg-white/10 text-paper/60",
};

const RESULT_LABEL: Record<FbShareStatus | ShareResultStatus | "info", string> = {
  ...STATUS_LABEL,
  attention: "Ação necessária",
  info: "Info",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon" });

const eur = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("pt-PT")} €`);

function Badge({ status, label }: { status: FbShareStatus | ShareResultStatus | "info"; label?: string }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {label ?? RESULT_LABEL[status]}
    </span>
  );
}

function readInterval(): number {
  try {
    const v = Number(window.localStorage.getItem("partilhas:intervalo"));
    return Number.isFinite(v) && v >= 5 ? v : 30;
  } catch {
    return 30;
  }
}

export function SharesPanel({
  accounts,
  account,
  groups,
  ads,
  attempts,
  cars,
  extensionZip,
  extensionVersion,
  categories,
  joins,
  schedules,
  missingDiscovery,
  autoScheduleId,
}: {
  accounts: FbAccountRow[];
  account: FbAccountRow | null;
  groups: FbGroupRow[];
  ads: FbShareAdRow[];
  attempts: FbShareAttemptRow[];
  cars: ShareCarOption[];
  extensionZip: string;
  /** A versão da extensão que vai com este site; uma instalada mais antiga tem de ser atualizada. */
  extensionVersion: string;
  categories: FbCategoryRow[];
  joins: FbGroupJoinRow[];
  schedules: FbScheduleRow[];
  /** Falta a migração 0056: os separadores novos mostram o aviso. */
  missingDiscovery: boolean;
  /** A página foi aberta pela extensão para correr este horário (?auto=). */
  autoScheduleId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // ---- Extensão -----------------------------------------------------------
  const [ext, setExt] = useState<ExtState>({ state: "checking" });
  const checkExtension = useCallback(async () => {
    try {
      const h = await extensionHello();
      setExt(
        h.paired
          ? { state: "ready", version: h.version, fbUserId: h.fbUserId, fbName: h.fbName ?? null, fbNames: h.fbNames ?? {} }
          : { state: "not_paired", version: h.version },
      );
      return h;
    } catch {
      setExt({ state: "missing" });
      return null;
    }
  }, []);
  useEffect(() => {
    void checkExtension();
    const t = window.setInterval(() => void checkExtension(), 6000);
    const onFocus = () => void checkExtension();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkExtension]);

  const fbNow = ext.state === "ready" ? ext.fbUserId : null;
  const wrongFacebook = !!account?.fb_user_id && !!fbNow && fbNow !== account.fb_user_id;
  const noFacebook = ext.state === "ready" && !fbNow;
  // Os nomes das contas do Facebook (lidos pela extensão), em vez dos números.
  const fbNames = ext.state === "ready" ? ext.fbNames : {};
  const fbNowName = ext.state === "ready" ? (ext.fbName ?? (fbNow ? (fbNames[fbNow] ?? null) : null)) : null;
  const boundName = account?.fb_user_id ? (fbNames[account.fb_user_id] ?? (account.fb_user_id === fbNow ? fbNowName : null)) : null;

  // ---- Anúncio escolhido ----------------------------------------------------
  const activeAds = ads.filter((a) => !a.archived);
  const [adId, setAdId] = useState<string>(() => activeAds[0]?.id ?? "");
  const ad = activeAds.find((a) => a.id === adId) ?? activeAds[0] ?? null;

  const latest = useMemo(() => (ad ? latestStatusByGroup(attempts, ad.id) : new Map()), [attempts, ad]);
  const queue = useMemo(() => (ad ? buildQueue(groups, attempts, ad) : []), [groups, attempts, ad]);
  const listed = groups.filter((g) => g.position !== null);

  // Partilhar só nos grupos de uma categoria, e/ou só em N grupos desta vez.
  const [shareCategoryId, setShareCategoryId] = useState("");
  const [shareMax, setShareMax] = useState(0); // 0 = todos
  const shareCategory = categories.find((c) => c.id === shareCategoryId) ?? null;
  // No máximo SHARE_DAILY_LIMIT partilhas por conta em 24 horas.
  const sharesLeft = useMemo(() => remainingShares(attempts, new Date()), [attempts]);
  const shareList = useMemo(() => {
    const list = shareCategory ? queue.filter((g) => matchesKeywords(g.name, shareCategory.keywords)) : queue;
    return list.slice(0, Math.min(shareMax > 0 ? shareMax : Infinity, sharesLeft));
  }, [queue, shareCategory, shareMax, sharesLeft]);

  const [tab, setTab] = useState<PanelTab>("share");

  // ---- Fila ------------------------------------------------------------------
  const [running, setRunning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [countdown, setCountdown] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [interval, setIntervalSec] = useState(30);
  const stopRef = useRef(false);
  useEffect(() => setIntervalSec(readInterval()), []);

  const [joining, setJoining] = useState(false);
  const [joinStatus, setJoinStatus] = useState<string | null>(null);
  const [found, setFound] = useState<FoundRow[]>([]);
  const remaining = useMemo(() => remainingJoins(joins, new Date()), [joins]);

  const busy = running || scanning || joining;
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const addLog = (group: string, status: LogLine["status"], text: string, label?: string) =>
    setLog((l) => [{ time: new Date().toISOString(), group, status, text, label }, ...l].slice(0, 200));

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (success) toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(res.error ?? "Não foi possível guardar.");
    });
  }

  async function readGroups() {
    if (!account) return;
    setScanning(true);
    addLog("—", "info", "A abrir a lista de grupos do Facebook numa janela nova…");
    try {
      const res = await extensionReadGroups();
      const saved = await saveScannedGroups(account.id, res.fbUserId, res.groups);
      if (!saved.ok) {
        toast.error(saved.error ?? "Não foi possível gravar os grupos.");
        addLog("—", "attention", saved.error ?? "Não foi possível gravar os grupos.");
      } else {
        const msg = `${saved.count} grupos lidos${saved.added ? `, ${saved.added} novos` : ""}.`;
        toast.success(msg);
        addLog("—", "info", msg);
        router.refresh();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "A leitura falhou.";
      toast.error(msg);
      addLog("—", "attention", msg);
    } finally {
      setScanning(false);
      void checkExtension();
    }
  }

  async function wait(seconds: number) {
    for (let s = seconds; s > 0; s--) {
      if (stopRef.current) break;
      setCountdown(s);
      await new Promise((r) => window.setTimeout(r, 1000));
    }
    setCountdown(0);
  }

  async function runQueue(opts?: { ad: FbShareAdRow; list: FbGroupRow[] }) {
    const theAd = opts?.ad ?? ad;
    let list = [...(opts?.list ?? shareList)];
    if (!account || !theAd || !list.length) return;
    const quota = await shareQuota(account.id);
    if (!quota.ok) return void addLog("—", "attention", quota.error ?? "Não foi possível ler o limite diário.");
    if (!quota.count)
      return void addLog("—", "info", `Esta conta já fez ${SHARE_DAILY_LIMIT} partilhas nas últimas 24 horas. Tente mais tarde.`);
    list = list.slice(0, quota.count);
    stopRef.current = false;
    setRunning(true);
    setProgress({ done: 0, total: list.length });
    addLog("—", "info", `A partilhar «${theAd.title}» em ${list.length} grupo(s), um de cada vez.`);
    try {
      for (let i = 0; i < list.length; i++) {
        if (stopRef.current) {
          addLog("—", "info", "Parado a seu pedido.");
          break;
        }
        const g = list[i]!;
        // A conta do Facebook do Chrome pode ter mudado a meio.
        const h = await extensionHello().catch(() => null);
        if (!h?.paired) {
          addLog(g.name, "attention", "A extensão deixou de responder. A fila parou.");
          break;
        }
        if (!h.fbUserId) {
          addLog(g.name, "attention", "O Chrome não tem sessão no Facebook. Inicie sessão e volte a carregar em Publicar.");
          break;
        }
        if (account.fb_user_id && h.fbUserId !== account.fb_user_id) {
          addLog(g.name, "attention", "O Chrome está agora noutra conta do Facebook. A fila parou.");
          break;
        }
        setCurrent(g.name);
        let res;
        try {
          res = await extensionShare(theAd.url, g.name, g.url);
        } catch (e) {
          addLog(g.name, "attention", e instanceof ExtensionError ? e.message : "A extensão falhou. A fila parou.");
          break;
        }
        if (res.status !== "attention") {
          const saved = await recordShareAttempt({
            accountId: account.id,
            groupId: g.id,
            adId: theAd.id,
            status: res.status,
            reason: res.reason,
          });
          if (!saved.ok) {
            addLog(g.name, "attention", `${res.reason} — e não foi possível gravar no histórico: ${saved.error}. A fila parou.`);
            break;
          }
        }
        addLog(g.name, res.status, res.reason);
        setProgress({ done: i + 1, total: list.length });
        if (res.stop || res.status === "attention") break;
        if (i < list.length - 1) await wait(interval);
      }
    } finally {
      setCurrent(null);
      setCountdown(0);
      setRunning(false);
      router.refresh();
    }
  }

  // ---- Procurar grupos e aderir -------------------------------------------

  /** O Chrome está na conta certa? Uma conta nova (sem grupos) fica associada aqui. */
  async function ensureFacebook(): Promise<boolean> {
    if (!account) return false;
    const h = await extensionHello().catch(() => null);
    if (!h?.paired) {
      addLog("—", "attention", "A extensão deixou de responder.");
      return false;
    }
    if (!h.fbUserId) {
      addLog("—", "attention", "O Chrome não tem sessão no Facebook. Inicie sessão e tente de novo.");
      return false;
    }
    if (account.fb_user_id && h.fbUserId !== account.fb_user_id) {
      addLog("—", "attention", "O Chrome está noutra conta do Facebook. Parado.");
      return false;
    }
    if (!account.fb_user_id) {
      const bound = await bindAccountIfNew(account.id, h.fbUserId);
      if (!bound.ok) {
        addLog("—", "attention", bound.error ?? "Não foi possível associar a conta.");
        return false;
      }
    }
    return true;
  }

  /** Os grupos que não se tentam: já tratados nesta conta ou já na lista de grupos. */
  const skipKeys = () =>
    new Set([...doneJoinKeys(joins), ...groups.map((g) => g.group_key)].map((k) => k.toLowerCase()));

  function toRows(list: FoundGroup[], keyword: string, category: FbCategoryRow, skip: Set<string>, publicOnly: boolean): FoundRow[] {
    const ok = new Set(pickJoinCandidates(list, { keywords: category.keywords, skipKeys: skip, publicOnly }).map((g) => g.key));
    return list.map((g) => ({
      ...g,
      keyword,
      candidate: ok.has(g.key),
      why:
        g.state === "member"
          ? "Já é membro."
          : g.state === "pending"
            ? "O pedido já está feito."
            : skip.has(g.key)
              ? "Já tratado nesta conta."
              : publicOnly && g.privacy !== "public"
                ? "Grupo privado."
                : !matchesKeywords(g.name, category.keywords)
                  ? "O nome não tem nenhuma das palavras-chave."
                  : "Outro tipo de artigos (bilhetes, imóveis…).",
    }));
  }

  const mergeRows = (prev: FoundRow[], rows: FoundRow[]) => {
    const seen = new Set(prev.map((r) => r.key));
    return [...prev, ...rows.filter((r) => !seen.has(r.key))];
  };

  /** Pede adesão a um grupo e grava o resultado. null = parar tudo. */
  async function joinOneInternal(g: FoundRow, categoryId: string): Promise<JoinOneResult | null> {
    if (!account || !(await ensureFacebook())) return null;
    setJoinStatus(`A aderir a «${g.name}»…`);
    let r: JoinOneResult;
    try {
      r = await extensionJoinGroup(g.keyword, g.key);
    } catch (e) {
      addLog(g.name, "attention", e instanceof ExtensionError ? e.message : "A extensão falhou. Parado.");
      return null;
    }
    const saved = await recordGroupJoin({ accountId: account.id, categoryId, group: g, keyword: g.keyword, status: r.status, reason: r.reason });
    if (!saved.ok) {
      addLog(g.name, "attention", `${r.reason} — e não foi possível gravar no histórico: ${saved.error}. Parado.`);
      return null;
    }
    addLog(g.name, JOIN_LOG_STATUS[r.status], r.reason, JOIN_STATUS_LABEL[r.status]);
    setFound((prev) => prev.map((x) => (x.key === g.key ? { ...x, candidate: false, why: JOIN_STATUS_LABEL[r.status] } : x)));
    return r;
  }

  async function runJoins(categoryId: string, count: number, publicOnly: boolean) {
    const category = categories.find((c) => c.id === categoryId);
    if (!account || !category) {
      addLog("—", "attention", "A categoria já não existe.");
      return;
    }
    stopRef.current = false;
    setJoining(true);
    let done = 0;
    try {
      if (!(await ensureFacebook())) return;
      const quota = await joinQuota(account.id);
      if (!quota.ok) return void addLog("—", "attention", quota.error ?? "Não foi possível ler o limite diário.");
      const left = Math.min(count, quota.remaining ?? 0);
      if (!left)
        return void addLog("—", "info", `Esta conta já chegou às ${JOIN_DAILY_LIMIT} adesões das últimas 24 horas. Tente amanhã.`);
      addLog("—", "info", `A procurar grupos de «${category.name}» para aderir a ${left}.`);
      setFound([]);
      const skip = skipKeys();
      let first = true;
      outer: for (const keyword of category.keywords) {
        if (stopRef.current) break;
        setJoinStatus(`A pesquisar «${keyword}» no Facebook…`);
        let rows: FoundRow[];
        try {
          const res = await extensionSearchGroups(keyword, 30);
          rows = toRows(cleanFoundGroups(res.groups), keyword, category, skip, publicOnly);
        } catch (e) {
          addLog("—", "attention", e instanceof Error ? e.message : "A pesquisa falhou.");
          break;
        }
        setFound((prev) => mergeRows(prev, rows));
        for (const g of rows.filter((r) => r.candidate)) {
          if (done >= left || stopRef.current) break outer;
          if (skip.has(g.key)) continue; // apareceu noutra palavra-chave
          if (!first) {
            const gap = JOIN_GAP_MIN_SECONDS + Math.round(Math.random() * JOIN_GAP_JITTER_SECONDS);
            setJoinStatus(`Próxima adesão dentro de pouco (${gap} s entre grupos)…`);
            await wait(gap);
            if (stopRef.current) break outer;
          }
          first = false;
          const r = await joinOneInternal(g, category.id);
          if (!r) break outer;
          skip.add(g.key);
          if (JOIN_COUNTED.includes(r.status)) done++;
          if (r.stop) break outer;
        }
      }
      addLog(
        "—",
        "info",
        stopRef.current
          ? `Parado a seu pedido (${done} adesão(ões)).`
          : done < left
            ? `Terminado: ${done} adesão(ões). Não encontrei mais grupos novos com estas palavras-chave; acrescente outras à categoria.`
            : `Terminado: ${done} adesão(ões).`,
      );
    } finally {
      setJoining(false);
      setJoinStatus(null);
      setCountdown(0);
      router.refresh();
    }
  }

  async function searchOnly(categoryId: string) {
    const category = categories.find((c) => c.id === categoryId);
    if (!account || !category) return;
    setJoining(true);
    setFound([]);
    try {
      if (!(await ensureFacebook())) return;
      const skip = skipKeys();
      for (const keyword of category.keywords) {
        setJoinStatus(`A pesquisar «${keyword}» no Facebook…`);
        try {
          const res = await extensionSearchGroups(keyword, 30);
          const rows = toRows(cleanFoundGroups(res.groups), keyword, category, skip, false);
          setFound((prev) => mergeRows(prev, rows));
        } catch (e) {
          addLog("—", "attention", e instanceof Error ? e.message : "A pesquisa falhou.");
          break;
        }
      }
    } finally {
      setJoining(false);
      setJoinStatus(null);
    }
  }

  async function joinOne(row: FoundRow, categoryId: string) {
    if (!account) return;
    setJoining(true);
    try {
      const quota = await joinQuota(account.id);
      if (!quota.ok) return void toast.error(quota.error ?? "Não foi possível ler o limite diário.");
      if (!quota.remaining) return void toast.error(`Esta conta já chegou às ${JOIN_DAILY_LIMIT} adesões das últimas 24 horas.`);
      await joinOneInternal(row, categoryId);
    } finally {
      setJoining(false);
      setJoinStatus(null);
      router.refresh();
    }
  }

  // ---- Horários automáticos -------------------------------------------------

  // A extensão guarda os horários desta conta e abre a página à hora certa.
  const scheduleSig = JSON.stringify(schedules.map((s) => [s.id, s.at_time, s.weekdays, s.enabled]));
  const accountId = account?.id;
  useEffect(() => {
    if (ext.state !== "ready" || !accountId) return;
    const items = (JSON.parse(scheduleSig) as [string, string, number[], boolean][]).map(([id, at, weekdays, enabled]) => ({
      id,
      at,
      weekdays,
      enabled,
    }));
    extensionSetSchedules(accountId, items).catch(() => {
      // Extensão antiga (sem horários): o aviso de atualização já aparece.
    });
  }, [ext.state, accountId, scheduleSig]);

  // Aberta pela extensão com ?auto=<id>: corre esse horário uma vez.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !autoScheduleId || !account || ext.state !== "ready" || busy) return;
    const s = schedules.find((x) => x.id === autoScheduleId);
    autoStarted.current = true;
    if (!s) return void addLog("—", "attention", "O horário automático já não existe.");
    if (!s.enabled) return void addLog("—", "info", "O horário automático está pausado.");
    if (s.last_run_at && lisbonDay(s.last_run_at) === lisbonDay(new Date()))
      return void addLog("—", "info", "Este horário já correu hoje.");
    void (async () => {
      addLog("—", "info", `Horário automático: ${describeSchedule(s.weekdays, s.at_time)}.`);
      await markScheduleRun(s.id); // antes de começar: se a página recarregar, não repete
      if (s.kind === "join" && s.category_id) {
        setTab("discover");
        await runJoins(s.category_id, s.count, false);
        return;
      }
      const theAd = ads.find((a) => a.id === s.ad_id && !a.archived);
      if (!theAd) return void addLog("—", "attention", "O anúncio deste horário foi arquivado ou apagado.");
      const cat = categories.find((c) => c.id === s.category_id);
      let list = buildQueue(groups, attempts, theAd);
      if (cat) list = list.filter((g) => matchesKeywords(g.name, cat.keywords));
      list = list.slice(0, s.count);
      setAdId(theAd.id);
      setTab("share");
      if (!list.length) return void addLog("—", "info", "Não há grupos na fila para este anúncio.");
      await runQueue({ ad: theAd, list });
    })();
    // As funções de cima mudam a cada render; o horário corre uma só vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScheduleId, account, ext.state, busy, schedules]);

  // ---- Sem contas ainda ---------------------------------------------------
  const [newName, setNewName] = useState("");
  function addAccount(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createFbAccount(newName);
      if (!res.ok) return void toast.error(res.error ?? "Não foi possível criar a conta.");
      setNewName("");
      toast.success("Conta criada.");
      router.push(`/admin/partilhas?conta=${res.id}`);
    });
  }

  // Extensão desatualizada: as versões antigas têm erros já corrigidos, por isso
  // não se publica nem se leem grupos com elas.
  const installedVersion = ext.state === "ready" || ext.state === "not_paired" ? ext.version : null;
  const outdated = installedVersion !== null && isOlderVersion(installedVersion, extensionVersion);
  const warnedVersion = useRef<string | null>(null);
  useEffect(() => {
    if (!outdated || !installedVersion || warnedVersion.current === installedVersion) return;
    warnedVersion.current = installedVersion;
    toast.warning(`Há uma versão nova da extensão (v${extensionVersion}). Atualize-a antes de publicar.`);
  }, [outdated, installedVersion, extensionVersion]);

  const canUseExtension = ext.state === "ready" && !outdated && !wrongFacebook && !noFacebook;

  // O estado da conta, fixo no topo: verde = pronto a trabalhar nesta conta.
  const fbStatus: { ok: boolean; text: string } =
    ext.state === "checking"
      ? { ok: false, text: "A verificar a extensão…" }
      : ext.state === "missing"
        ? { ok: false, text: "Extensão não instalada neste Chrome" }
        : ext.state === "not_paired"
          ? { ok: false, text: "Extensão por autorizar neste site" }
          : outdated
            ? { ok: false, text: "Extensão desatualizada" }
            : noFacebook
              ? { ok: false, text: "Sem sessão no Facebook neste Chrome" }
              : wrongFacebook
                ? { ok: false, text: "O Chrome está noutra conta do Facebook" }
                : { ok: true, text: account?.fb_user_id ? "Facebook ligado e pronto" : "Facebook ligado (conta nova, ainda por associar)" };

  const logNode =
    log.length > 0 ? (
      <ul className="max-h-72 space-y-2 overflow-y-auto border-t border-white/10 pt-3 text-sm">
        {log.map((l, i) => (
          <li key={`${l.time}-${i}`} className="flex gap-2">
            <Badge status={l.status} label={l.label} />
            <span className="min-w-0 text-paper/70">
              {l.group !== "—" && <strong className="text-paper">{l.group}: </strong>}
              {l.text}
            </span>
          </li>
        ))}
      </ul>
    ) : null;

  const TABS: [PanelTab, string][] = [
    ["share", "Partilhar no Marketplace"],
    ["discover", "Procurar grupos"],
    ["setup", "Categorias e horários"],
  ];

  return (
    <div className="space-y-6">
      {account && (
        <div className="sticky top-24 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink/90 px-4 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`h-3 w-3 shrink-0 rounded-full ${fbStatus.ok ? "bg-emerald-400 shadow-[0_0_10px] shadow-emerald-400/60" : "bg-red-400"}`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="truncate font-semibold text-paper">{(!wrongFacebook && fbNowName) || boundName || account.name}</p>
              <p className={`text-xs ${fbStatus.ok ? "text-emerald-300/80" : "text-red-300/90"}`}>
                {fbStatus.text}
                {wrongFacebook && fbNowName ? ` (está em «${fbNowName}»)` : ""}
                {((!wrongFacebook && fbNowName) || boundName) && ((!wrongFacebook && fbNowName) || boundName) !== account.name
                  ? ` · separador «${account.name}»`
                  : ""}
              </p>
            </div>
          </div>
          {(running || joining || scanning) && (
            <p className="text-xs text-paper/60" aria-live="polite">
              {scanning ? "A ler os grupos…" : running ? `A partilhar ${progress.done} de ${progress.total}…` : (joinStatus ?? "A trabalhar…")}
              {countdown ? ` · ${countdown} s` : ""}
            </p>
          )}
        </div>
      )}

      {outdated && installedVersion ? (
        <UpdateExtensionCard installed={installedVersion} latest={extensionVersion} zip={extensionZip} onRetry={() => void checkExtension()} />
      ) : (
        <ExtensionCard ext={ext} zip={extensionZip} onRetry={() => void checkExtension()} />
      )}

      {/* Separadores: uma conta do Facebook por separador. */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Contas do Facebook">
        {accounts.map((a) => {
          const active = a.id === account?.id;
          const cls = `rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            active ? "bg-paper text-ink" : "border border-white/15 text-paper/80 hover:border-white/40"
          }`;
          return busy || active ? (
            <span key={a.id} role="tab" aria-selected={active} className={`${cls} ${!active ? "opacity-50" : ""}`}>
              {a.name}
            </span>
          ) : (
            <Link key={a.id} role="tab" aria-selected={false} href={`/admin/partilhas?conta=${a.id}`} className={cls}>
              {a.name}
            </Link>
          );
        })}
        <form onSubmit={addAccount} className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={accounts.length ? "Nova conta…" : "Nome da conta, ex.: Facebook Stand"}
            className="field h-10 !w-56"
            maxLength={80}
            aria-label="Nome da nova conta do Facebook"
            disabled={busy}
          />
          <button type="submit" className="btn-ghost h-10 px-4" disabled={pending || busy || !newName.trim()}>
            + Conta
          </button>
        </form>
      </div>

      {!account ? (
        <div className="card p-6 text-sm text-paper/70">
          Crie uma conta para começar: dê-lhe o nome que quiser (por exemplo, o nome do perfil do Facebook). Cada conta tem a
          sua lista de grupos; para usar outra conta do Facebook, crie outro separador.
        </div>
      ) : (
        <>
          <AccountCard
            account={account}
            fbNowName={fbNowName}
            boundName={boundName}
            wrongFacebook={wrongFacebook}
            noFacebook={noFacebook}
            busy={busy || pending}
            scanning={scanning}
            canRead={canUseExtension}
            onRead={() => void readGroups()}
            onRename={(name) => act(() => renameFbAccount(account.id, name), "Nome alterado.")}
            onUnbind={() => act(() => unbindFbAccount(account.id), "Conta desassociada.")}
            onDelete={() =>
              startTransition(async () => {
                const res = await deleteFbAccount(account.id);
                if (!res.ok) return void toast.error(res.error ?? "Não foi possível apagar.");
                toast.success("Conta apagada.");
                router.push("/admin/partilhas");
              })
            }
          />

          <div className="flex flex-wrap gap-2 border-b border-white/10" role="tablist" aria-label="O que fazer">
            {TABS.map(([k, l]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === k ? "border-accent text-paper" : "border-transparent text-paper/50 hover:text-paper/80"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {tab !== "share" && missingDiscovery ? (
            <p role="alert" className="card p-4 text-sm text-amber-300">
              Falta aplicar a migração <code>0056_facebook_discovery.sql</code> no Supabase.
            </p>
          ) : tab === "discover" ? (
            <DiscoverPanel
              categories={categories}
              joins={joins}
              groups={groups}
              remaining={remaining}
              busy={busy || pending}
              canUse={canUseExtension}
              running={joining}
              status={joinStatus ? `${joinStatus}${countdown ? ` (${countdown} s)` : ""}` : null}
              found={found}
              log={logNode}
              onSearch={(id) => void searchOnly(id)}
              onRun={(id, n, publicOnly) => void runJoins(id, n, publicOnly)}
              onJoinOne={(row, id) => void joinOne(row, id)}
              onStop={() => (stopRef.current = true)}
              onCheckAccepted={() => void readGroups()}
              onGoToCategories={() => setTab("setup")}
            />
          ) : tab === "setup" ? (
            <CategoriesSchedules
              account={account}
              categories={categories}
              schedules={schedules}
              ads={ads}
              busy={busy || pending}
              extensionReady={ext.state === "ready" && !outdated}
              act={act}
            />
          ) : (
          <>
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <AdCard
              ads={activeAds}
              ad={ad}
              cars={cars}
              busy={busy || pending}
              onSelect={setAdId}
              onCreated={(id) => setAdId(id)}
              onArchive={(id) => act(() => archiveShareAd(id), "Anúncio arquivado.")}
            />

            <div className="card space-y-4 p-5">
              <h2 className="text-lg font-semibold text-paper">Publicar</h2>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  ["Grupos", listed.length],
                  ["Desta vez", shareList.length],
                  ["Hoje (24 h)", `${SHARE_DAILY_LIMIT - sharesLeft} de ${SHARE_DAILY_LIMIT}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-white/10 p-3">
                    <p className="text-xs uppercase tracking-wider text-paper/50">{label}</p>
                    <p className="mt-1 text-xl font-semibold text-paper">{value}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-paper/70">
                  Em que grupos
                  <select
                    className="field mt-1"
                    value={shareCategory?.id ?? ""}
                    disabled={running}
                    onChange={(e) => setShareCategoryId(e.target.value)}
                  >
                    <option value="">Todos os da fila ({queue.length})</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        Só «{c.name}» ({queue.filter((g) => matchesKeywords(g.name, c.keywords)).length})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-paper/70">
                  Quantos desta vez
                  <select
                    className="field mt-1"
                    value={shareMax}
                    disabled={running}
                    onChange={(e) => setShareMax(Number(e.target.value))}
                  >
                    <option value={0}>O máximo (até {SHARE_DAILY_LIMIT} por dia)</option>
                    {[1, 2, 3, 5, 8, 10].map((n) => (
                      <option key={n} value={n}>
                        {n} grupo{n === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {categories.length === 0 && (
                <p className="text-xs text-paper/40">
                  Para partilhar só nos grupos de uma categoria (ex.: «Motas»), crie-a em{" "}
                  <button type="button" className="underline hover:text-paper" onClick={() => setTab("setup")}>
                    Categorias e horários
                  </button>
                  .
                </p>
              )}
              <label className="flex items-center gap-3 text-sm text-paper/70">
                Intervalo entre grupos
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={interval}
                  disabled={running}
                  onChange={(e) => {
                    const v = Math.min(600, Math.max(5, Number(e.target.value) || 30));
                    setIntervalSec(v);
                    try {
                      window.localStorage.setItem("partilhas:intervalo", String(v));
                    } catch {}
                  }}
                  className="field h-10 !w-24"
                />
                segundos
              </label>
              <div className="flex flex-wrap gap-2">
                {running ? (
                  <button type="button" className="btn-ghost" onClick={() => (stopRef.current = true)}>
                    Parar depois deste grupo
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!ad || !shareList.length || !canUseExtension || busy || pending}
                    onClick={() => void runQueue()}
                  >
                    Publicar pela ordem ({shareList.length})
                  </button>
                )}
              </div>
              {running && (
                <p className="text-sm text-paper/70" aria-live="polite">
                  {progress.done} de {progress.total}
                  {current && !countdown ? ` · a partilhar em «${current}»…` : ""}
                  {countdown ? ` · próximo grupo dentro de ${countdown} s` : ""}
                </p>
              )}
              <p className="text-xs text-paper/40">
                Deixe esta página aberta enquanto publica: é ela que comanda a extensão. A janela do Facebook abre à parte; não
                mexa nela durante a partilha. Se o Facebook mostrar um limite ou pedir uma verificação, a fila pára.
              </p>
              {logNode}
            </div>
          </div>

          <GroupsTable
            account={account}
            groups={groups}
            categories={categories}
            ad={ad}
            latest={latest}
            busy={busy || pending}
            onInclude={(id, choice) => act(() => setGroupInclude(id, choice))}
            onIncludeMany={(ids, choice, label) => act(() => setGroupsInclude(ids, choice), label)}
            onReset={(groupId) =>
              ad &&
              act(() => resetShareGroup({ accountId: account.id, groupId, adId: ad.id }), "Grupo desbloqueado para este anúncio.")
            }
            onAddManual={(text, done) => act(() => addManualGroups(account.id, text), "Grupos acrescentados.", done)}
          />

          <History attempts={attempts} groups={groups} ads={ads} />
          </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function UpdateExtensionCard({
  installed,
  latest,
  zip,
  onRetry,
}: {
  installed: string;
  latest: string;
  zip: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="card border-amber-500/40 p-5 text-sm text-paper/80">
      <p className="font-semibold text-amber-300">
        Há uma versão nova da extensão: v{latest} (no seu Chrome está a v{installed})
      </p>
      <p className="mt-1 text-paper/60">
        A versão antiga tem erros já corrigidos. Atualize-a antes de ler grupos ou publicar; até lá, esses botões ficam
        desligados.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5">
        <li>
          <a href={zip} download className="text-accent underline">
            Descarregue a extensão nova
          </a>{" "}
          e descompacte-a <strong>por cima da pasta</strong> onde está a atual (substitua os ficheiros).
        </li>
        <li>
          Abra <code>chrome://extensions</code> e, na «CoreMotors Partilhas», carregue em <strong>Recarregar</strong> (↻).
        </li>
        <li>Volte a esta página: o aviso desaparece quando a versão nova estiver ligada.</li>
      </ol>
      <p className="mt-2 text-xs text-paper/50">
        Se instalou a extensão a partir da pasta do projeto, basta o passo 2.
      </p>
      <button type="button" className="btn-ghost mt-3" onClick={onRetry}>
        Verificar de novo
      </button>
    </div>
  );
}

function ExtensionCard({ ext, zip, onRetry }: { ext: ExtState; zip: string; onRetry: () => void }) {
  if (ext.state === "checking") return null;
  if (ext.state === "ready")
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-paper/60">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
        Extensão ligada (v{ext.version})
        {ext.fbUserId ? ` · Facebook aberto no Chrome: conta ${ext.fbUserId}` : " · sem sessão no Facebook neste Chrome"}
      </p>
    );
  if (ext.state === "not_paired")
    return (
      <div className="card border-amber-500/30 p-5 text-sm text-paper/80">
        <p className="font-semibold text-paper">Falta autorizar este site na extensão</p>
        <p className="mt-1">
          Clique no ícone da extensão «CoreMotors Partilhas» na barra do Chrome (no puzzle 🧩, se não estiver afixada) e
          carregue em <strong>Autorizar este site</strong>. Só é preciso uma vez.
        </p>
        <button type="button" className="btn-ghost mt-3" onClick={onRetry}>
          Já autorizei
        </button>
      </div>
    );
  return (
    <div className="card p-5 text-sm text-paper/80">
      <p className="font-semibold text-paper">Instale a extensão «CoreMotors Partilhas» no Chrome</p>
      <p className="mt-1 text-paper/60">
        É ela que faz os cliques no Facebook, no seu Chrome e com a sua sessão. O backoffice nunca recebe a sua palavra-passe.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5">
        <li>
          <a href={zip} download className="text-accent underline">
            Descarregue a extensão
          </a>{" "}
          e descompacte o ficheiro numa pasta que não vá apagar.
        </li>
        <li>
          Abra <code>chrome://extensions</code> e ligue o <strong>Modo de programador</strong> (canto superior direito).
        </li>
        <li>
          Carregue em <strong>Carregar sem compactação</strong> e escolha a pasta descompactada.
        </li>
        <li>Volte a esta página, recarregue-a e autorize o site no ícone da extensão.</li>
      </ol>
      <button type="button" className="btn-ghost mt-3" onClick={onRetry}>
        Verificar de novo
      </button>
    </div>
  );
}

function AccountCard({
  account,
  fbNowName,
  boundName,
  wrongFacebook,
  noFacebook,
  busy,
  scanning,
  canRead,
  onRead,
  onRename,
  onUnbind,
  onDelete,
}: {
  account: FbAccountRow;
  /** O nome da conta aberta no Chrome agora. */
  fbNowName: string | null;
  /** O nome da conta associada a este separador (se já foi vista neste Chrome). */
  boundName: string | null;
  wrongFacebook: boolean;
  noFacebook: boolean;
  busy: boolean;
  scanning: boolean;
  canRead: boolean;
  onRead: () => void;
  onRename: (name: string) => void;
  onUnbind: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  return (
    <div className="card space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {editing ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                onRename(name);
                setEditing(false);
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} className="field h-10" maxLength={80} autoFocus />
              <button type="submit" className="btn-primary h-10 px-4" disabled={!name.trim()}>
                Guardar
              </button>
              <button type="button" className="btn-ghost h-10 px-4" onClick={() => setEditing(false)}>
                Cancelar
              </button>
            </form>
          ) : (
            <h2 className="text-lg font-semibold text-paper">{account.name}</h2>
          )}
          <p className="mt-1 text-sm text-paper/50">
            {account.fb_user_id
              ? boundName
                ? `Associada à conta do Facebook «${boundName}»`
                : "Associada a uma conta do Facebook (o nome aparece quando essa conta estiver aberta neste Chrome)"
              : "Ainda não associada: a primeira leitura dos grupos (ou pesquisa de grupos) associa-a à conta aberta no Chrome."}
            {account.groups_read_at && ` · grupos lidos em ${when(account.groups_read_at)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={busy || !canRead} onClick={onRead}>
            {scanning ? "A ler grupos…" : "Ler grupos do Facebook"}
          </button>
          {!editing && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setEditing(true)}>
              Mudar nome
            </button>
          )}
          {account.fb_user_id && (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() =>
                window.confirm("Desassociar esta conta? A próxima leitura dos grupos associa-a à conta aberta no Chrome.") &&
                onUnbind()
              }
            >
              Desassociar
            </button>
          )}
          <button
            type="button"
            className="btn-ghost text-red-300"
            disabled={busy}
            onClick={() =>
              window.confirm(`Apagar «${account.name}», os grupos dela e o histórico destas partilhas? Não se pode desfazer.`) &&
              onDelete()
            }
          >
            Apagar
          </button>
        </div>
      </div>
      {wrongFacebook && (
        <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
          O Chrome está ligado a outra conta do Facebook{fbNowName ? ` («${fbNowName}»)` : ""}
          {boundName ? `, e este separador é da «${boundName}»` : ""}. Troque de conta no Facebook ou abra o separador dessa
          conta. Nada é lido nem publicado até baterem certo.
        </p>
      )}
      {noFacebook && (
        <p role="alert" className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-300">
          Este Chrome não tem sessão no Facebook. Abra{" "}
          <a href="https://www.facebook.com/" target="_blank" rel="noreferrer" className="underline">
            facebook.com
          </a>{" "}
          e inicie sessão.
        </p>
      )}
    </div>
  );
}

function AdCard({
  ads,
  ad,
  cars,
  busy,
  onSelect,
  onCreated,
  onArchive,
}: {
  ads: FbShareAdRow[];
  ad: FbShareAdRow | null;
  cars: ShareCarOption[];
  busy: boolean;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(ads.length === 0);
  const [saving, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const car = ad?.car_id ? cars.find((c) => c.id === ad.car_id) : null;

  function pickCar(id: string) {
    const c = cars.find((x) => x.id === id);
    const f = formRef.current;
    if (!c || !f) return;
    const set = (n: string, v: string) => {
      const el = f.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement | null;
      if (el && (!el.value || n === "vehicle_type")) el.value = v;
    };
    set("title", c.label);
    if (c.price !== null) set("price", String(c.price));
    set("vehicle_type", c.vehicle_type);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createShareAd(data);
      if (!res.ok) return void toast.error(res.error ?? "Não foi possível guardar.");
      toast.success("Anúncio guardado.");
      formRef.current?.reset();
      setOpen(false);
      if (res.id) onCreated(res.id);
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-paper">Anúncio</h2>
        <button type="button" className="btn-ghost px-4 py-2" onClick={() => setOpen((o) => !o)} disabled={busy}>
          {open ? "Fechar" : "+ Novo anúncio"}
        </button>
      </div>

      {ads.length > 0 && (
        <select
          className="field"
          value={ad?.id ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          disabled={busy}
          aria-label="Anúncio a partilhar"
        >
          {ads.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      )}

      {ad && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-paper/50">Link</dt>
          <dd className="min-w-0 truncate">
            <a href={ad.url} target="_blank" rel="noreferrer" className="text-accent underline">
              {ad.url}
            </a>
          </dd>
          <dt className="text-paper/50">Preço</dt>
          <dd className="text-paper/80">{eur(ad.price)}</dd>
          <dt className="text-paper/50">Tipo</dt>
          <dd className="text-paper/80">{ad.vehicle_type === "motorcycle" ? "Mota" : "Carro"}</dd>
          {car && (
            <>
              <dt className="text-paper/50">Viatura</dt>
              <dd className="text-paper/80">{car.label}</dd>
            </>
          )}
          <dd className="col-span-2 pt-2">
            <button
              type="button"
              className="text-xs text-paper/50 underline hover:text-paper"
              disabled={busy}
              onClick={() => window.confirm("Arquivar este anúncio? O histórico fica guardado.") && onArchive(ad.id)}
            >
              Arquivar anúncio
            </button>
          </dd>
        </dl>
      )}

      {open && (
        <form ref={formRef} onSubmit={submit} className="space-y-3 border-t border-white/10 pt-4">
          {cars.length > 0 && (
            <div>
              <label className="field-label" htmlFor="ad-car">
                Viatura do inventário (opcional)
              </label>
              <select id="ad-car" name="car_id" className="field" defaultValue="" onChange={(e) => pickCar(e.target.value)}>
                <option value="">— Nenhuma —</option>
                {cars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.price !== null ? ` · ${eur(c.price)}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="ad-url">
              Link do anúncio no Facebook
            </label>
            <input
              id="ad-url"
              name="url"
              className="field"
              required
              placeholder="https://www.facebook.com/marketplace/item/…"
              inputMode="url"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="ad-title">
              Título
            </label>
            <input id="ad-title" name="title" className="field" required maxLength={160} placeholder="Mercedes A 180d AMG 2015" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="ad-price">
                Preço (€)
              </label>
              <input id="ad-price" name="price" className="field" inputMode="decimal" placeholder="13450" />
            </div>
            <div>
              <label className="field-label" htmlFor="ad-type">
                Tipo
              </label>
              <select id="ad-type" name="vehicle_type" className="field" defaultValue="car">
                <option value="car">Carro</option>
                <option value="motorcycle">Mota</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-paper/40">
            O preço e o tipo servem para sugerir que grupos ficam de fora (ex.: grupos de motas, ou «até 10 000 €»).
          </p>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "A guardar…" : "Guardar anúncio"}
          </button>
        </form>
      )}
    </div>
  );
}

function GroupsTable({
  account,
  groups,
  ad,
  latest,
  busy,
  onInclude,
  onIncludeMany,
  onReset,
  onAddManual,
  categories,
}: {
  account: FbAccountRow;
  groups: FbGroupRow[];
  /** As categorias do utilizador (palavras-chave), como filtros extra. */
  categories: FbCategoryRow[];
  ad: FbShareAdRow | null;
  latest: Map<string, FbShareAttemptRow>;
  busy: boolean;
  onInclude: (id: string, choice: "auto" | "sim" | "nao") => void;
  onIncludeMany: (ids: string[], choice: "auto" | "sim" | "nao", success: string) => void;
  onReset: (groupId: string) => void;
  onAddManual: (text: string, done: () => void) => void;
}) {
  const [showGone, setShowGone] = useState(false);
  const [manual, setManual] = useState("");
  const [filter, setFilter] = useState("");
  // Os tipos escolhidos nos filtros (vazio = todos).
  const [cats, setCats] = useState<ReadonlySet<GroupCategory>>(new Set());
  const gone = groups.filter((g) => g.position === null).length;
  const category = useMemo(() => new Map(groups.map((g) => [g.id, groupCategory(g.name)])), [groups]);
  const shown = groups.filter((g) => showGone || g.position !== null);
  const counts = new Map<GroupCategory, number>();
  for (const g of shown) counts.set(category.get(g.id)!, (counts.get(category.get(g.id)!) ?? 0) + 1);
  // As categorias do utilizador: o grupo entra se o nome tiver uma das palavras de alguma escolhida.
  const [userCats, setUserCats] = useState<ReadonlySet<string>>(new Set());
  const chosenUserCats = categories.filter((c) => userCats.has(c.id));
  const visible = shown
    .filter((g) => cats.size === 0 || cats.has(category.get(g.id)!))
    .filter((g) => chosenUserCats.length === 0 || chosenUserCats.some((c) => matchesKeywords(g.name, c.keywords)))
    .filter((g) => !filter || g.name.toLocaleLowerCase("pt-PT").includes(filter.toLocaleLowerCase("pt-PT")));
  const filtering = cats.size > 0 || chosenUserCats.length > 0 || filter.trim() !== "";
  const toggleUserCat = (id: string) =>
    setUserCats((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const inQueue = ad ? visible.filter((g) => g.position !== null && isIncluded(g, ad)).length : 0;
  const toggleCat = (c: GroupCategory) =>
    setCats((cur) => {
      const next = new Set(cur);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  const applyToVisible = (choice: "auto" | "sim" | "nao") => {
    const ids = visible.map((g) => g.id);
    const what = { sim: "incluídos sempre", nao: "excluídos sempre", auto: "de volta ao automático" }[choice];
    if (!ids.length) return;
    if (!window.confirm(`Mudar ${ids.length} grupo${ids.length === 1 ? "" : "s"} para «${what}»?`)) return;
    onIncludeMany(ids, choice, `${ids.length} grupo${ids.length === 1 ? "" : "s"} ${what}.`);
  };

  return (
    <div className="card p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-lg font-semibold text-paper">Grupos de {account.name}</h2>
          <p className="text-sm text-paper/50">
            Pela ordem do Facebook. «Automático» segue a sugestão pelo nome do grupo; mude para incluir ou excluir sempre.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Procurar grupo…"
            className="field h-10 !w-48"
            aria-label="Procurar grupo"
          />
          {gone > 0 && (
            <label className="flex items-center gap-2 text-sm text-paper/60">
              <input type="checkbox" checked={showGone} onChange={(e) => setShowGone(e.target.checked)} />
              Mostrar os que saíram ({gone})
            </label>
          )}
        </div>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por tipo de grupo">
            <button
              type="button"
              onClick={() => setCats(new Set())}
              aria-pressed={cats.size === 0}
              className={`rounded-full px-3 py-1 text-xs ${cats.size === 0 ? "bg-accent text-ink" : "bg-white/10 text-paper/70 hover:bg-white/15"}`}
            >
              Todos ({shown.length})
            </button>
            {GROUP_CATEGORIES.filter((c) => counts.get(c)).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCat(c)}
                aria-pressed={cats.has(c)}
                className={`rounded-full px-3 py-1 text-xs ${cats.has(c) ? "bg-accent text-ink" : "bg-white/10 text-paper/70 hover:bg-white/15"}`}
              >
                {GROUP_CATEGORY_LABEL[c]} ({counts.get(c)})
              </button>
            ))}
          </div>
          {categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar pelas suas categorias">
              <span className="text-xs text-paper/40">As suas categorias:</span>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleUserCat(c.id)}
                  aria-pressed={userCats.has(c.id)}
                  title={c.keywords.join(", ")}
                  className={`rounded-full px-3 py-1 text-xs ${userCats.has(c.id) ? "bg-accent text-ink" : "border border-white/15 text-paper/70 hover:border-white/40"}`}
                >
                  {c.name} ({shown.filter((g) => matchesKeywords(g.name, c.keywords)).length})
                </button>
              ))}
            </div>
          )}
          {filtering && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-paper/60">
              <span>
                {visible.length} grupo{visible.length === 1 ? "" : "s"} filtrado{visible.length === 1 ? "" : "s"}
                {ad && ` · ${inQueue} entra${inQueue === 1 ? "" : "m"} na fila deste anúncio`}:
              </span>
              <button type="button" className="btn-ghost h-8 px-3 text-xs" disabled={busy || !visible.length} onClick={() => applyToVisible("sim")}>
                Incluir todos
              </button>
              <button type="button" className="btn-ghost h-8 px-3 text-xs" disabled={busy || !visible.length} onClick={() => applyToVisible("nao")}>
                Excluir todos
              </button>
              <button type="button" className="btn-ghost h-8 px-3 text-xs" disabled={busy || !visible.length} onClick={() => applyToVisible("auto")}>
                Voltar ao automático
              </button>
            </div>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="border-t border-white/10 p-5 text-sm text-paper/60">
          Ainda não há grupos. Carregue em <strong>Ler grupos do Facebook</strong> com o Chrome ligado a esta conta, ou
          acrescente-os à mão em baixo.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-paper/50">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">Grupo</th>
                <th className="p-3">Entra na fila</th>
                <th className="p-3">{ad ? "Este anúncio" : "Estado"}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map((g) => {
                const suggestion = ad ? suggestExclusion(g.name, ad) : "";
                const last = latest.get(g.id);
                return (
                  <tr key={g.id} className={`border-t border-white/10 ${g.position === null ? "opacity-50" : ""}`}>
                    <td className="p-3 text-paper/50">{g.position ?? "—"}</td>
                    <td className="max-w-[22rem] p-3">
                      {g.url ? (
                        <a href={g.url} target="_blank" rel="noreferrer" className="text-paper hover:text-accent">
                          {g.name}
                        </a>
                      ) : (
                        <span className="text-paper">{g.name}</span>
                      )}
                      {g.position === null && <span className="ml-2 text-xs text-paper/40">(já não aparece)</span>}
                      <span className="mt-0.5 block text-xs text-paper/40">{GROUP_CATEGORY_LABEL[category.get(g.id)!]}</span>
                    </td>
                    <td className="p-3">
                      <select
                        className="field h-9 !w-auto py-1"
                        value={g.include === null ? "auto" : g.include ? "sim" : "nao"}
                        disabled={busy}
                        onChange={(e) => onInclude(g.id, e.target.value as "auto" | "sim" | "nao")}
                        aria-label={`Entra na fila: ${g.name}`}
                      >
                        <option value="auto">{suggestion ? `Automático: não (${suggestion})` : "Automático: sim"}</option>
                        <option value="sim">Incluir sempre</option>
                        <option value="nao">Excluir sempre</option>
                      </select>
                    </td>
                    <td className="p-3">
                      {last ? (
                        <span className="flex flex-col gap-1">
                          <Badge status={last.status} />
                          <span className="text-xs text-paper/40" title={last.reason ?? undefined}>
                            {when(last.created_at)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-paper/40">—</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {ad && isBlocked(last?.status) && (
                        <button
                          type="button"
                          className="text-xs text-paper/50 underline hover:text-paper"
                          disabled={busy}
                          onClick={() =>
                            window.confirm(
                              `Voltar a permitir partilhar este anúncio em «${g.name}»? Confirme primeiro no Facebook que a partilha não ficou feita, para não a repetir.`,
                            ) && onReset(g.id)
                          }
                        >
                          Desbloquear
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="border-t border-white/10 p-5">
        <summary className="cursor-pointer text-sm text-paper/70">Acrescentar grupos à mão</summary>
        <p className="mt-2 text-xs text-paper/40">
          Um nome ou endereço do grupo por linha, se a leitura automática não os encontrar. Use o nome exatamente como aparece
          no Facebook: é por ele que a extensão o procura ao partilhar.
        </p>
        <textarea
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          rows={4}
          className="field mt-2"
          placeholder={"Marketplace Portugal, Compra & Venda\nhttps://www.facebook.com/groups/123456789/"}
        />
        <button
          type="button"
          className="btn-ghost mt-2"
          disabled={busy || !manual.trim()}
          onClick={() => onAddManual(manual, () => setManual(""))}
        >
          Acrescentar
        </button>
      </details>
    </div>
  );
}

function History({
  attempts,
  groups,
  ads,
}: {
  attempts: FbShareAttemptRow[];
  groups: FbGroupRow[];
  ads: FbShareAdRow[];
}) {
  const [all, setAll] = useState(false);
  if (!attempts.length) return null;
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const adTitle = new Map(ads.map((a) => [a.id, a.title]));
  const rows = all ? attempts : attempts.slice(0, 25);
  return (
    <div className="card overflow-x-auto p-0">
      <h2 className="p-5 pb-2 text-lg font-semibold text-paper">Histórico desta conta</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-paper/50">
          <tr>
            <th className="p-3">Quando</th>
            <th className="p-3">Grupo</th>
            <th className="p-3">Anúncio</th>
            <th className="p-3">Resultado</th>
            <th className="p-3">Detalhe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-white/10 align-top">
              <td className="whitespace-nowrap p-3 text-paper/60">{when(a.created_at)}</td>
              <td className="p-3 text-paper">{groupName.get(a.group_id) ?? "—"}</td>
              <td className="p-3 text-paper/70">{adTitle.get(a.ad_id) ?? "—"}</td>
              <td className="p-3">
                <Badge status={a.status} />
              </td>
              <td className="p-3 text-paper/60">{a.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {attempts.length > 25 && (
        <button type="button" className="m-5 text-sm text-paper/60 underline" onClick={() => setAll((v) => !v)}>
          {all ? "Mostrar menos" : `Mostrar tudo (${attempts.length})`}
        </button>
      )}
    </div>
  );
}
