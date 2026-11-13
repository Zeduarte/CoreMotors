"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  confirmOlxSuggestions,
  createCarFromOlxAdvert,
  linkOlxAdvert,
  setOlxAdvertActive,
  unlinkOlxAdvert,
} from "@/lib/actions/olx-adverts";
import type { OlxActionResult } from "@/lib/actions/olx";
import type { AdvertOrigin } from "@/lib/olx/adverts";
import { REMOTE_STATUS_LABEL } from "@/lib/olx/lifecycle";

/**
 * «Anúncios no OLX»: todos os anúncios da conta ligada, com a viatura a que
 * pertencem. Os do Standvirtual só se veem (alteram-se lá); os geridos pela
 * ficha mudam de estado na ficha; os outros têm aqui as ações.
 */

export interface AdvertRowView {
  id: number;
  title: string;
  url: string | null;
  origin: AdvertOrigin;
  status: string;
  views: number | null;
  phone_views: number | null;
  observers: number | null;
  /** `managed`: a viatura tem OLX marcado e o anúncio não é do Standvirtual. */
  car: { id: string; label: string; managed: boolean } | null;
  suggestion: { carId: string; label: string; strong: boolean } | null;
}

const ORIGIN_LABEL: Record<AdvertOrigin, string> = { site: "Site", olx: "OLX", standvirtual: "Standvirtual" };
/** Estados em que o anúncio está à vista no OLX: aqui só se desativa. */
const LIVE = new Set(["active", "new"]);

const count = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-PT"));

export function OlxAdvertsTable({
  adverts,
  cars,
  readAt,
}: {
  adverts: AdvertRowView[];
  cars: { id: string; label: string }[];
  readAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<OlxActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Feito.");
      else toast.error(r.error ?? "Não foi possível.");
      router.refresh();
    });

  const strong = adverts.filter((a) => !a.car && a.suggestion?.strong).length;
  const soma = (k: "views" | "phone_views" | "observers") => adverts.reduce((s, a) => s + (a[k] ?? 0), 0).toLocaleString("pt-PT");
  const sorted = [...adverts].sort((a, b) => Number(!!a.car) - Number(!!b.car) || (b.views ?? 0) - (a.views ?? 0));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-paper/50">Anúncios no OLX</h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-paper/40">
            {readAt ? `Lidos ${new Date(readAt).toLocaleString("pt-PT")} · todos os dias automaticamente` : "Ainda não lidos."}
          </span>
          {strong > 0 && (
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => {
                if (confirm(`Associar ${strong} anúncio(s) às viaturas sugeridas (marca, modelo e preço iguais)?`))
                  run(confirmOlxSuggestions);
              }}
            >
              Confirmar {strong} sugestões
            </button>
          )}
        </div>
      </div>

      {adverts.length === 0 ? (
        <p className="text-sm text-paper/60">Sem anúncios. Carregue em «Ler anúncios do OLX».</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Visualizações", soma("views")],
              ["Viram o telefone", soma("phone_views")],
              ["A seguir", soma("observers")],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs text-paper/50">{label}</p>
                <p className="mt-1 text-lg font-semibold text-paper">{value}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-paper/50">
                <tr>
                  <th className="py-2 pr-3">Anúncio</th>
                  <th className="px-3 py-2">Origem</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Vis.</th>
                  <th className="px-3 py-2 text-right">Tel.</th>
                  <th className="px-3 py-2 text-right">Seg.</th>
                  <th className="px-3 py-2">Viatura</th>
                  <th className="py-2 pl-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((a) => (
                  <AdvertRow key={a.id} advert={a} cars={cars} pending={pending} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function AdvertRow({
  advert: a,
  cars,
  pending,
  run,
}: {
  advert: AdvertRowView;
  cars: { id: string; label: string }[];
  pending: boolean;
  run: (fn: () => Promise<OlxActionResult>) => void;
}) {
  const [chosen, setChosen] = useState(a.suggestion?.carId ?? "");
  const vive = LIVE.has(a.status);

  const associar = (carId: string) => {
    const aviso =
      a.origin === "standvirtual"
        ? "Associar este anúncio à viatura?"
        : "Associar este anúncio à viatura? Se ela tiver OLX marcado, o anúncio passa a ter o texto, as fotos e o preço da ficha.";
    if (confirm(aviso)) run(() => linkOlxAdvert(a.id, carId));
  };

  return (
    <tr className="border-t border-white/10 align-top">
      <td className="py-2 pr-3">
        <span className="text-paper">{a.title}</span>
        {a.url && (
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-paper/40 hover:text-paper">
            ↗ OLX
          </a>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-paper/70">{ORIGIN_LABEL[a.origin]}</td>
      <td className="px-3 py-2 text-xs text-paper/60">{REMOTE_STATUS_LABEL[a.status] ?? a.status}</td>
      <td className="px-3 py-2 text-right text-paper">{count(a.views)}</td>
      <td className="px-3 py-2 text-right text-paper/70">{count(a.phone_views)}</td>
      <td className="px-3 py-2 text-right text-paper/70">{count(a.observers)}</td>
      <td className="px-3 py-2">
        {a.car ? (
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/admin/carros/${a.car.id}`} className="text-paper hover:text-accent">
              {a.car.label}
            </a>
            {a.origin !== "site" && (
              <button
                type="button"
                className="text-xs text-paper/50 underline hover:text-paper"
                disabled={pending}
                onClick={() => {
                  if (confirm("Desassociar este anúncio da viatura? O anúncio no OLX fica como está.")) run(() => unlinkOlxAdvert(a.id));
                }}
              >
                Desassociar
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {a.suggestion && (
              <p className="text-xs text-paper/60">
                Sugestão: <span className="text-paper">{a.suggestion.label}</span>
                {a.suggestion.strong ? "" : " (preço diferente)"}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <select className="field max-w-56 text-xs" value={chosen} onChange={(e) => setChosen(e.target.value)} aria-label="Escolher viatura">
                <option value="">Escolher viatura…</option>
                {cars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-ghost text-xs" disabled={pending || !chosen} onClick={() => associar(chosen)}>
                Associar
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={pending}
                onClick={() => {
                  if (confirm("Criar uma viatura em rascunho com os dados e as fotos deste anúncio?")) run(() => createCarFromOlxAdvert(a.id));
                }}
              >
                Criar viatura
              </button>
            </div>
          </div>
        )}
      </td>
      <td className="py-2 pl-3 text-xs">
        {a.origin === "standvirtual" ? (
          <span className="text-paper/50">Gerido no Standvirtual</span>
        ) : a.car?.managed ? (
          <span className="text-paper/50">Gere-se na ficha</span>
        ) : vive ? (
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={pending}
            onClick={() => {
              if (confirm("Desativar este anúncio no OLX?")) run(() => setOlxAdvertActive(a.id, false));
            }}
          >
            Desativar
          </button>
        ) : (
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={pending}
            onClick={() => {
              if (confirm("Ativar este anúncio no OLX? O OLX pode cobrar a ativação.")) run(() => setOlxAdvertActive(a.id, true));
            }}
          >
            Ativar
          </button>
        )}
      </td>
    </tr>
  );
}
