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
  unbindFbAccount,
} from "@/lib/actions/fb-shares";
import {
  STATUS_LABEL,
  buildQueue,
  isBlocked,
  latestStatusByGroup,
  suggestExclusion,
  type ShareResultStatus,
} from "@/lib/fb-shares";
import { ExtensionError, extensionHello, extensionReadGroups, extensionShare } from "@/lib/fb-extension";
import type { ShareCarOption } from "@/lib/fb-shares-queries";
import type {
  FbAccountRow,
  FbGroupRow,
  FbShareAdRow,
  FbShareAttemptRow,
  FbShareStatus,
} from "@/lib/supabase/database.types";

type ExtState =
  | { state: "checking" }
  | { state: "missing" }
  | { state: "not_paired"; version: string }
  | { state: "ready"; version: string; fbUserId: string | null };

interface LogLine {
  time: string;
  group: string;
  status: ShareResultStatus | "info";
  text: string;
}

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

function Badge({ status }: { status: FbShareStatus | ShareResultStatus | "info" }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {RESULT_LABEL[status]}
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
}: {
  accounts: FbAccountRow[];
  account: FbAccountRow | null;
  groups: FbGroupRow[];
  ads: FbShareAdRow[];
  attempts: FbShareAttemptRow[];
  cars: ShareCarOption[];
  extensionZip: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // ---- Extensão -----------------------------------------------------------
  const [ext, setExt] = useState<ExtState>({ state: "checking" });
  const checkExtension = useCallback(async () => {
    try {
      const h = await extensionHello();
      setExt(h.paired ? { state: "ready", version: h.version, fbUserId: h.fbUserId } : { state: "not_paired", version: h.version });
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

  // ---- Anúncio escolhido ----------------------------------------------------
  const activeAds = ads.filter((a) => !a.archived);
  const [adId, setAdId] = useState<string>(() => activeAds[0]?.id ?? "");
  const ad = activeAds.find((a) => a.id === adId) ?? activeAds[0] ?? null;

  const latest = useMemo(() => (ad ? latestStatusByGroup(attempts, ad.id) : new Map()), [attempts, ad]);
  const queue = useMemo(() => (ad ? buildQueue(groups, attempts, ad) : []), [groups, attempts, ad]);
  const listed = groups.filter((g) => g.position !== null);

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

  const busy = running || scanning;
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const addLog = (group: string, status: LogLine["status"], text: string) =>
    setLog((l) => [{ time: new Date().toISOString(), group, status, text }, ...l].slice(0, 200));

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

  async function runQueue() {
    if (!account || !ad || !queue.length) return;
    const list = [...queue];
    stopRef.current = false;
    setRunning(true);
    setProgress({ done: 0, total: list.length });
    addLog("—", "info", `A partilhar «${ad.title}» em ${list.length} grupo(s), um de cada vez.`);
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
          res = await extensionShare(ad.url, g.name, g.url);
        } catch (e) {
          addLog(g.name, "attention", e instanceof ExtensionError ? e.message : "A extensão falhou. A fila parou.");
          break;
        }
        if (res.status !== "attention") {
          const saved = await recordShareAttempt({
            accountId: account.id,
            groupId: g.id,
            adId: ad.id,
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

  const canUseExtension = ext.state === "ready" && !wrongFacebook && !noFacebook;

  return (
    <div className="space-y-6">
      <ExtensionCard ext={ext} zip={extensionZip} onRetry={() => void checkExtension()} />

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
            fbNow={fbNow}
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
                  ["Na fila", queue.length],
                  ["Já feitos", ad ? listed.filter((g) => isBlocked(latest.get(g.id)?.status)).length : 0],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-white/10 p-3">
                    <p className="text-xs uppercase tracking-wider text-paper/50">{label}</p>
                    <p className="mt-1 text-xl font-semibold text-paper">{value}</p>
                  </div>
                ))}
              </div>
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
                    disabled={!ad || !queue.length || !canUseExtension || busy || pending}
                    onClick={() => void runQueue()}
                  >
                    Publicar pela ordem ({queue.length})
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
              {log.length > 0 && (
                <ul className="max-h-72 space-y-2 overflow-y-auto border-t border-white/10 pt-3 text-sm">
                  {log.map((l, i) => (
                    <li key={`${l.time}-${i}`} className="flex gap-2">
                      <Badge status={l.status} />
                      <span className="min-w-0 text-paper/70">
                        {l.group !== "—" && <strong className="text-paper">{l.group}: </strong>}
                        {l.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <GroupsTable
            account={account}
            groups={groups}
            ad={ad}
            latest={latest}
            busy={busy || pending}
            onInclude={(id, choice) => act(() => setGroupInclude(id, choice))}
            onReset={(groupId) =>
              ad &&
              act(() => resetShareGroup({ accountId: account.id, groupId, adId: ad.id }), "Grupo desbloqueado para este anúncio.")
            }
            onAddManual={(text, done) => act(() => addManualGroups(account.id, text), "Grupos acrescentados.", done)}
          />

          <History attempts={attempts} groups={groups} ads={ads} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

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
  fbNow,
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
  fbNow: string | null;
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
              ? `Associada à conta do Facebook ${account.fb_user_id}`
              : "Ainda não associada: a primeira leitura dos grupos associa-a à conta aberta no Chrome."}
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
          O Chrome está ligado a outra conta do Facebook ({fbNow}). Troque de conta no Facebook ou abra o separador dessa
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
  onReset,
  onAddManual,
}: {
  account: FbAccountRow;
  groups: FbGroupRow[];
  ad: FbShareAdRow | null;
  latest: Map<string, FbShareAttemptRow>;
  busy: boolean;
  onInclude: (id: string, choice: "auto" | "sim" | "nao") => void;
  onReset: (groupId: string) => void;
  onAddManual: (text: string, done: () => void) => void;
}) {
  const [showGone, setShowGone] = useState(false);
  const [manual, setManual] = useState("");
  const [filter, setFilter] = useState("");
  const gone = groups.filter((g) => g.position === null).length;
  const visible = groups
    .filter((g) => showGone || g.position !== null)
    .filter((g) => !filter || g.name.toLocaleLowerCase("pt-PT").includes(filter.toLocaleLowerCase("pt-PT")));

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
