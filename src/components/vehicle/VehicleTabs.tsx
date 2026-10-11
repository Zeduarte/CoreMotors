"use client";

import { useId, useState, type ReactNode } from "react";

/** Onde a viatura está (ponto de venda ou, na falta dele, o stand). */
export interface VehiclePlace {
  name: string;
  address: string;
  postalCode: string;
  city: string;
  hours: string;
  phone: string;
  /** Coordenadas ("lat,lng") ou morada, para o mapa e as direções. */
  query: string;
}

type Tab = "descricao" | "equipamento" | "ficha" | "localizacao";

/**
 * Separadores por baixo do primeiro ecrã: "Descrição | Equipamento | Ficha
 * técnica | Localização". Só aparecem os que têm conteúdo, e o painel só é
 * montado quando se abre (o mapa não pesa no carregamento e as animações da
 * ficha técnica começam quando ela fica à vista).
 */
export function VehicleTabs({
  description,
  equipment,
  specs,
  place,
}: {
  description: string;
  /** Extras agrupados (já desenhados no servidor), ou `null` se não houver. */
  equipment: ReactNode;
  /** Ficha técnica + histórico (já desenhados no servidor). */
  specs: ReactNode;
  place: VehiclePlace | null;
}) {
  const tabs: { id: Tab; label: string }[] = [
    ...(description ? [{ id: "descricao" as Tab, label: "Descrição" }] : []),
    ...(equipment ? [{ id: "equipamento" as Tab, label: "Equipamento" }] : []),
    { id: "ficha", label: "Ficha técnica" },
    ...(place ? [{ id: "localizacao" as Tab, label: "Localização" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]!.id);
  const id = useId();

  return (
    <section aria-label="Mais sobre a viatura">
      {/* Telemóvel: a barra faz scroll para o lado se não couber. */}
      <div className="-mx-6 overflow-x-auto px-6 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
        <div
          role="tablist"
          aria-label="Mais sobre a viatura"
          className="inline-grid min-w-full auto-cols-fr grid-flow-col gap-1 rounded-2xl border border-white/10 bg-ink-soft p-1 md:min-w-[36rem]"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${id}-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${id}-panel`}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                tab === t.id ? "bg-white/10 text-paper" : "text-paper/55 hover:text-paper"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="mt-4">
        {tab === "descricao" && (
          <div className="rounded-3xl bg-ink-soft p-6 md:p-8">
            <div className="max-w-3xl space-y-4 text-[15px] font-light leading-relaxed text-paper/80">
              {description
                .split(/\n+/)
                .map((p) => p.trim())
                .filter(Boolean)
                .map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
            </div>
          </div>
        )}
        {tab === "equipamento" && equipment}
        {tab === "ficha" && <div className="rounded-3xl bg-ink-soft p-6 md:p-8">{specs}</div>}
        {tab === "localizacao" && place && <Location place={place} />}
      </div>
    </section>
  );
}

function Location({ place }: { place: VehiclePlace }) {
  const q = encodeURIComponent(place.query);
  return (
    <div className="grid overflow-hidden rounded-3xl bg-ink-soft md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-3 p-6 md:p-8">
        <h2 className="text-xl font-semibold text-paper">{place.name}</h2>
        <p className="text-sm text-paper/70">
          {place.address}
          {(place.postalCode || place.city) && (
            <>
              <br />
              {place.postalCode} {place.city}
            </>
          )}
        </p>
        {place.hours && <p className="whitespace-pre-line text-sm text-paper/55">{place.hours}</p>}
        {place.phone && (
          <a className="block text-sm text-paper/80 hover:text-accent" href={`tel:${place.phone.replace(/[^\d+]/g, "")}`}>
            {place.phone}
          </a>
        )}
        <a
          className="btn-ghost"
          target="_blank"
          rel="noopener noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&destination=${q}`}
        >
          Obter direções ↗
        </a>
      </div>
      <iframe
        title={`Mapa de ${place.name}`}
        className="h-64 w-full border-0 md:h-full md:min-h-72"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        src={`https://maps.google.com/maps?q=${q}&output=embed`}
      />
    </div>
  );
}
