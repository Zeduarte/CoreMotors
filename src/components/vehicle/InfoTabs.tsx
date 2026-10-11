"use client";

import { useId, useState } from "react";

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

type Tab = "descricao" | "localizacao";

/**
 * Separadores "Descrição | Localização" ao lado da galeria. O mapa só é
 * carregado quando se abre a localização — não pesa no primeiro ecrã.
 *
 * Estica até ao fundo da coluna (`flex-1`), para o cartão acabar à altura
 * da foto.
 */
export function InfoTabs({
  description,
  place,
}: {
  description: string;
  place: VehiclePlace | null;
}) {
  const tabs = [
    ...(description ? [{ id: "descricao" as Tab, label: "Descrição" }] : []),
    ...(place ? [{ id: "localizacao" as Tab, label: "Localização" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "descricao");
  const id = useId();
  if (tabs.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-label="Mais sobre a viatura">
      {tabs.length > 1 && (
        <div
          role="tablist"
          aria-label="Mais sobre a viatura"
          className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-ink-soft p-1"
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
              className={`rounded-xl py-2 text-sm font-semibold transition-colors ${
                tab === t.id ? "bg-white/10 text-paper" : "text-paper/55 hover:text-paper"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div
        id={`${id}-panel`}
        role={tabs.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={tabs.length > 1 ? `${id}-${tab}` : undefined}
        className="flex-1 rounded-3xl bg-ink-soft p-5"
      >
        {tab === "descricao" && description ? (
          <Description text={description} />
        ) : place ? (
          <Location place={place} />
        ) : null}
      </div>
    </section>
  );
}

/** Texto do anúncio: fechado mostra as primeiras linhas, com "Ler mais". */
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const isLong = text.length > 200 || paragraphs.length > 3;

  return (
    <>
      <h2 className="text-lg font-semibold text-paper">Descrição</h2>
      <div className={`relative mt-2 ${open || !isLong ? "" : "max-h-24 overflow-hidden"}`}>
        <div className="space-y-3 text-sm font-light leading-relaxed text-paper/75">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {!open && isLong && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-ink-soft to-transparent" />
        )}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-2 text-sm font-semibold text-accent transition-opacity hover:opacity-80"
        >
          {open ? "Ler menos" : "Ler mais"}
        </button>
      )}
    </>
  );
}

function Location({ place }: { place: VehiclePlace }) {
  const q = encodeURIComponent(place.query);
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-paper">{place.name}</h2>
        <p className="mt-1 text-sm text-paper/70">
          {place.address}
          {(place.postalCode || place.city) && (
            <>
              <br />
              {place.postalCode} {place.city}
            </>
          )}
        </p>
      </div>
      {place.hours && (
        <p className="whitespace-pre-line text-xs text-paper/55">{place.hours}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <a
          className="font-semibold text-accent hover:opacity-80"
          target="_blank"
          rel="noopener noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&destination=${q}`}
        >
          Obter direções ↗
        </a>
        {place.phone && (
          <a className="text-paper/80 hover:text-accent" href={`tel:${place.phone.replace(/[^\d+]/g, "")}`}>
            {place.phone}
          </a>
        )}
      </div>
      <iframe
        title={`Mapa de ${place.name}`}
        className="h-44 w-full rounded-2xl border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        src={`https://maps.google.com/maps?q=${q}&output=embed`}
      />
    </div>
  );
}
