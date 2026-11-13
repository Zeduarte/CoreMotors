"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CHANNELS, COMING_SOON } from "@/lib/schemas";
import { saveListing } from "@/lib/actions/channels";
import { refreshOlxStats, retryOlxListing, setCarOlxCategory } from "@/lib/actions/olx";
import { OlxCategoryPicker } from "./OlxCategoryPicker";
import { REMOTE_STATUS_LABEL } from "@/lib/olx/lifecycle";
import type { AdvertOrigin } from "@/lib/olx/adverts";
import type {
  ChannelListingRow,
  ChannelListingStatus,
} from "@/lib/supabase/database.types";

const STATUS_OPTIONS: { value: ChannelListingStatus; label: string }[] = [
  { value: "pending", label: "Pendente" },
  { value: "published", label: "Publicado" },
  { value: "removed", label: "Removido" },
  { value: "error", label: "Erro" },
];

const STATUS_TONE: Record<ChannelListingStatus, string> = {
  pending: "bg-white/10 text-paper/70",
  published: "bg-emerald-500/20 text-emerald-300",
  removed: "bg-white/10 text-paper/40",
  error: "bg-red-500/20 text-red-300",
};

function feedBase() {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (env) return env;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/**
 * Gere o estado de publicação de UMA viatura em cada portal selecionado.
 * A publicação em si é por feed (o portal importa /api/feeds/<canal>.xml);
 * aqui o stand regista o estado real, o link do anúncio e a data.
 */
export function ChannelListings({
  carId,
  channels,
  listings,
  olxCategory,
  olxAdvert,
}: {
  carId: string;
  channels: string[];
  listings: ChannelListingRow[];
  /** Categoria do OLX desta viatura e a padrão do tipo (nomes legíveis). */
  olxCategory?: { own: string | null; fallback: string | null };
  /** Anúncio da conta do OLX associado a esta viatura (Plataformas de anúncios). */
  olxAdvert?: OlxAdvertSummary | null;
}) {
  const byChannel = new Map(listings.map((l) => [l.channel, l]));
  // Um anúncio do Standvirtual, ou um do OLX sem OLX marcado: mostra-se o que
  // existe no OLX em vez do estado da sincronização (que não lhe toca).
  const olxInfo = olxAdvert && (olxAdvert.origin === "standvirtual" || !channels.includes("olx")) ? olxAdvert : null;
  // Tipo largo: o ramo dos portais com formulário próprio volta a servir
  // quando outro portal ficar disponível.
  const selected: { id: string; label: string; available: boolean }[] = CHANNELS.filter(
    (c) => channels.includes(c.id) && !(olxInfo && c.id === "olx"),
  );

  return (
    <section className="card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-paper/50">
          Publicação nos portais
        </h2>
        <p className="mt-1 text-xs text-paper/50">
          O anúncio no OLX é criado e atualizado sozinho. Os outros portais
          estão a ser preparados.
        </p>
      </div>

      {olxInfo && <OlxAdvertInfo advert={olxInfo} />}

      {olxInfo && selected.length === 0 ? null : selected.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-paper/60">
          Nenhum portal selecionado. Escolhe os portais em{" "}
          <strong className="text-paper/80">
            &quot;Publicar noutras plataformas&quot;
          </strong>{" "}
          no formulário e guarda a viatura — depois aparecem aqui para gerires o
          estado.
        </p>
      ) : (
        <div className="space-y-4">
          {selected.map((c) =>
            // O OLX é publicado pelo próprio sistema: mostra-se o estado real,
            // não um formulário para o registar à mão.
            c.id === "olx" ? (
              <OlxRow key={c.id} carId={carId} listing={byChannel.get(c.id) ?? null} category={olxCategory} />
            ) : !c.available ? (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <span className="font-semibold text-paper/70">{c.label}</span>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-paper/60">{COMING_SOON}</span>
              </div>
            ) : (
            <ChannelRow
              key={c.id}
              carId={carId}
              channelId={c.id}
              channelLabel={c.label}
              listing={byChannel.get(c.id) ?? null}
            />
            ),
          )}
        </div>
      )}
    </section>
  );
}

export interface OlxAdvertSummary {
  title: string;
  url: string | null;
  origin: AdvertOrigin;
  status: string;
  views: number | null;
  phone_views: number | null;
  observers: number | null;
}

/** O anúncio do OLX desta viatura quando não é o backoffice a geri-lo. */
function OlxAdvertInfo({ advert }: { advert: OlxAdvertSummary }) {
  const n = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-PT"));
  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-paper">OLX</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-paper/70">
            {REMOTE_STATUS_LABEL[advert.status] ?? advert.status}
          </span>
        </div>
        {advert.url && (
          <a href={advert.url} target="_blank" rel="noopener noreferrer" className="text-xs text-paper/50 hover:text-paper">
            ↗ Ver no OLX
          </a>
        )}
      </div>
      <p className="mt-2 text-paper/80">{advert.title}</p>
      <p className="mt-1 text-xs text-paper/50">
        {n(advert.views)} visualizações · {n(advert.phone_views)} viram o telefone · {n(advert.observers)} a seguir
      </p>
      <p className="mt-2 text-xs text-amber-300">
        {advert.origin === "standvirtual"
          ? "Este anúncio vem do Standvirtual: altera-se lá."
          : "Marque OLX para o backoffice passar a gerir este anúncio."}
      </p>
    </div>
  );
}

function ChannelRow({
  carId,
  channelId,
  channelLabel,
  listing,
}: {
  carId: string;
  channelId: string;
  channelLabel: string;
  listing: ChannelListingRow | null;
}) {
  const [status, setStatus] = useState<ChannelListingStatus>(
    listing?.status ?? "pending",
  );
  const [url, setUrl] = useState(listing?.external_url ?? "");
  const [pending, startTransition] = useTransition();

  const feedUrl = `${feedBase()}/api/feeds/${channelId}.xml`;
  const publishedAt = listing?.published_at
    ? new Date(listing.published_at).toLocaleDateString("pt-PT")
    : null;

  function save() {
    startTransition(async () => {
      const res = await saveListing({
        car_id: carId,
        channel: channelId,
        status,
        external_url: url,
      });
      if (res.ok) toast.success(`${channelLabel}: estado guardado.`);
      else toast.error(res.error ?? "Não foi possível guardar.");
    });
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-paper">{channelLabel}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}
          >
            {STATUS_OPTIONS.find((s) => s.value === status)?.label}
          </span>
        </div>
        {publishedAt && (
          <span className="text-xs text-paper/40">
            desde {publishedAt}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
        <label className="block">
          <span className="field-label">Estado</span>
          <select
            className="field"
            value={status}
            onChange={(e) => setStatus(e.target.value as ChannelListingStatus)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="field-label">Link do anúncio (opcional)</span>
          <input
            className="field"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={`https://…/${channelId}/…`}
          />
        </label>

        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn-primary h-auto whitespace-nowrap px-5 py-2.5"
        >
          {pending ? "A guardar…" : "Guardar"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-paper/45">
        <span>Feed deste portal:</span>
        <a
          href={feedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {feedUrl}
        </a>
        {listing?.external_url && (
          <a
            href={listing.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-paper/70 hover:text-paper"
          >
            ↗ Ver anúncio
          </a>
        )}
      </div>
    </div>
  );
}

// `== null` apanha também `undefined`: sem a migração 0030 as colunas nem existem.
const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-PT"));

/** Visualizações, telefone e seguidores do anúncio no OLX. */
function OlxStats({ carId, listing }: { carId: string; listing: ChannelListingRow }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      {[
        ["Visualizações", listing.views],
        ["Viram o telefone", listing.phone_views],
        ["A seguir", listing.observers],
      ].map(([label, value]) => (
        <span key={label as string} className="rounded-lg bg-white/5 px-3 py-1.5 text-paper/70">
          {label}: <strong className="text-paper">{fmt(value as number | null)}</strong>
        </span>
      ))}
      <button
        type="button"
        disabled={pending}
        className="text-xs text-paper/50 hover:text-paper"
        onClick={() =>
          startTransition(async () => {
            const r = await refreshOlxStats(carId);
            if (r.ok) toast.success(r.message ?? "Estatísticas atualizadas.");
            else toast.error(r.error ?? "Não foi possível atualizar.");
          })
        }
      >
        {pending ? "A atualizar…" : "↻ Atualizar"}
      </button>
      <span className="text-xs text-paper/40">
        {listing.stats_at
          ? `atualizado ${new Date(listing.stats_at).toLocaleString("pt-PT")}`
          : "ainda sem estatísticas"}
      </span>
    </div>
  );
}

/** Categoria do OLX desta viatura: a padrão do tipo, ou outra só para ela. */
function OlxCategoryRow({
  carId,
  category,
}: {
  carId: string;
  category?: { own: string | null; fallback: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const save = (id: number | null, path?: string) =>
    startTransition(async () => {
      const r = await setCarOlxCategory(carId, id, path);
      if (r.ok) {
        toast.success(r.message ?? "Categoria guardada.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível guardar.");
      }
    });

  return (
    <div className="mt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-paper/60">Categoria no OLX:</span>
        {category?.own ? (
          <span className="text-paper">{category.own}</span>
        ) : (
          <span className="text-paper/80">
            {category?.fallback ?? "por escolher em Plataformas de anúncios"}{" "}
            <span className="text-xs text-paper/40">(padrão)</span>
          </span>
        )}
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setOpen(!open)}>
          {category?.own ? "Mudar" : "Usar outra só nesta viatura"}
        </button>
        {category?.own && (
          <button type="button" disabled={pending} className="text-xs text-paper/50 hover:text-paper" onClick={() => save(null)}>
            Voltar à padrão
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2">
          <OlxCategoryPicker busy={pending} onCancel={() => setOpen(false)} onPick={(c, path) => save(c.id, path)} />
        </div>
      )}
    </div>
  );
}

/** Estado da publicação automática no OLX. */
function OlxRow({
  carId,
  listing,
  category,
}: {
  carId: string;
  listing: ChannelListingRow | null;
  category?: { own: string | null; fallback: string | null };
}) {
  const [pending, startTransition] = useTransition();
  const estado = listing?.remote_status
    ? REMOTE_STATUS_LABEL[listing.remote_status] ?? listing.remote_status
    : listing?.sync_state === "pending"
      ? "a publicar…"
      : "ainda não publicado";
  const erro = listing?.sync_state === "error" || listing?.remote_status === "limited";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-paper">OLX</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              erro
                ? "bg-red-500/20 text-red-300"
                : listing?.remote_status === "active"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-white/10 text-paper/70"
            }`}
          >
            {estado}
          </span>
          <span className="text-xs text-paper/40">automático</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {listing?.external_url && (
            <a href={listing.external_url} target="_blank" rel="noopener noreferrer" className="text-paper/70 hover:text-paper">
              ↗ Ver no OLX
            </a>
          )}
          <button
            type="button"
            disabled={pending}
            className="btn-ghost px-3 py-1.5 text-xs"
            onClick={() =>
              startTransition(async () => {
                const r = await retryOlxListing(carId);
                if (r.ok) toast.success(r.message ?? "Sincronizado.");
                else toast.error(r.error ?? "Não foi possível sincronizar.");
              })
            }
          >
            {pending ? "A sincronizar…" : "Sincronizar agora"}
          </button>
        </div>
      </div>
      {listing?.last_error && (
        <p className="mt-3 text-sm text-red-300">{listing.last_error}</p>
      )}
      <OlxCategoryRow carId={carId} category={category} />
      {listing?.external_id && <OlxStats carId={carId} listing={listing} />}
      {listing?.last_synced_at && (
        <p className="mt-2 text-xs text-paper/40">
          Última sincronização: {new Date(listing.last_synced_at).toLocaleString("pt-PT")}
        </p>
      )}
    </div>
  );
}
