"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { FadeImage } from "@/components/ui/FadeImage";
import { ViewTransition } from "@/components/ui/ViewTransition";
import { VehiclePrice } from "@/components/vehicle/VehiclePrice";
import { registrationLabel } from "@/lib/vehicle-categories";
import type { Vehicle } from "@/types/vehicle";
import { formatKm, priceLabel } from "@/lib/format";
import { CompareButton } from "@/components/inventory/CompareButton";
import { FavoriteButton } from "@/components/inventory/FavoriteButton";
import { badgesFor } from "@/lib/badges";
import { useBadges } from "@/components/site/BadgesContext";
import { setVehiclePreview } from "@/lib/vehicle-preview";

interface VehicleCardProps {
  vehicle: Vehicle;
  /** Prioridade de imagem para os cards acima da dobra (LCP). */
  priority?: boolean;
  /** Índice para a jante do stagger (informativo). */
  index?: number;
  /**
   * Foto partilhada com a galeria da ficha (voa do cartão para a ficha ao
   * abrir, e de volta ao regressar). Só na lista principal de cada página:
   * o mesmo carro em duas listas (ex.: relacionadas e vistas recentemente)
   * daria dois nomes iguais e o browser cancelava a transição.
   */
  sharedTransition?: boolean;
}

/**
 * Card de viatura reutilizado na homepage e no inventário.
 *
 * A foto é um `<ViewTransition name="vehicle-<slug>">`, o mesmo nome da
 * galeria da ficha: ao abrir o anúncio, cresce do cartão até à galeria.
 * As micro-interações são CSS: elevação e zoom da foto no hover/foco, e o
 * cartão encolhe ligeiramente assim que é clicado (`data-nav-pending`), para
 * o clique ter resposta mesmo antes de a ficha chegar do servidor.
 */
/** Etiquetas da viatura, com o texto e a cor de Definições → Etiquetas. */
function useVehicleBadges(vehicle: Vehicle) {
  return badgesFor(vehicle, useBadges());
}

export function VehicleCard({
  vehicle,
  priority = false,
  sharedTransition = true,
}: VehicleCardProps) {
  const images = vehicle.images.length ? vehicle.images : [];
  const badges = useVehicleBadges(vehicle);
  const [index, setIndex] = useState(0);
  const current = images[index] ?? images[0]!;
  const hasMultiple = images.length > 1;

  // As setas mudam a foto sem navegar para a ficha (o card é um Link).
  function step(e: React.MouseEvent, dir: 1 | -1) {
    e.preventDefault();
    e.stopPropagation();
    setIndex((i) => (i + dir + images.length) % images.length);
  }

  const router = useRouter();
  const href = `/viaturas/${vehicle.slug}`;
  // Intenção de abrir (rato por cima, dedo a tocar, foco): começa já a pedir
  // a ficha inteira ao servidor, para o clique ser quase instantâneo. Os
  // cartões fora deste gesto não pedem nada (não carrega o servidor à toa).
  const prefetched = useRef(false);
  function prefetch() {
    if (prefetched.current) return;
    prefetched.current = true;
    router.prefetch(href, { kind: "full" } as Parameters<typeof router.prefetch>[1]);
  }

  return (
    <article className="group relative rounded-3xl border border-white/10 bg-ink-soft p-3 transition-[transform,border-color,background-color,box-shadow] duration-500 ease-premium focus-within:-translate-y-1 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.04] hover:shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)] active:scale-[0.98] active:duration-150 has-[[data-nav-pending]]:translate-y-0 has-[[data-nav-pending]]:scale-[0.97] has-[[data-nav-pending]]:border-accent/40">
      <Link
        href={href}
        onPointerEnter={prefetch}
        onTouchStart={prefetch}
        onFocus={prefetch}
        // A foto à vista vai já para o esqueleto da ficha (ver loading.tsx).
        onClick={(e) => setVehiclePreview(vehicle.slug, e.currentTarget.querySelector("img")?.currentSrc)}
        className="block focus:outline-none"
        aria-label={`${vehicle.make} ${vehicle.model} ${vehicle.year} — ${priceLabel(vehicle.price, vehicle.priceOnRequest)}`}
      >
        <ViewTransition
          name={sharedTransition ? `vehicle-${vehicle.slug}` : undefined}
          share="vehicle-morph"
        >
        <div
          data-vt-card={vehicle.slug}
          className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-ink-muted"
        >
          <div className="absolute inset-0 transition-transform duration-700 ease-premium group-focus-within:scale-105 group-hover:scale-105">
            {/* Fade cruzado entre fotos: a anterior desvanece enquanto a nova
                entra (com fade próprio quando acaba de carregar). */}
            <AnimatePresence initial={false}>
              <motion.div
                key={current.src}
                className="absolute inset-0"
                exit={{ opacity: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }}
              >
                <FadeImage
                  src={current.src}
                  alt={current.alt}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  priority={priority}
                  className="object-cover"
                />
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="absolute right-4 top-4 flex items-center gap-2">
            <FavoriteButton slug={vehicle.slug} />
            <span className="rounded-full bg-ink/70 px-3 py-1 text-xs font-medium text-paper backdrop-blur">
              {vehicle.year}
            </span>
          </div>

          {badges.length > 0 && (
            <div className="absolute left-4 top-4 flex flex-col items-start gap-1.5">
              {badges.map((b) => (
                <span
                  key={b.id}
                  className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ backgroundColor: b.color, color: b.text }}
                >
                  {b.label}
                </span>
              ))}
            </div>
          )}

          {/* Setas entre fotos: só com rato. Num ecrã táctil um toque no
              cartão abre logo o anúncio (as fotos vêem-se na ficha). */}
          {hasMultiple && (
            <>
              <button
                type="button"
                onClick={(e) => step(e, -1)}
                aria-label="Foto anterior"
                className="absolute left-2 top-1/2 hidden can-hover:grid h-9 w-9 -translate-y-1/2 scale-90 place-items-center rounded-full bg-ink/60 text-paper opacity-0 backdrop-blur transition-[opacity,transform,background-color] duration-300 ease-premium hover:bg-ink/80 group-hover:scale-100 group-hover:opacity-100 focus:scale-100 focus:opacity-100"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(e) => step(e, 1)}
                aria-label="Foto seguinte"
                className="absolute right-2 top-1/2 hidden can-hover:grid h-9 w-9 -translate-y-1/2 scale-90 place-items-center rounded-full bg-ink/60 text-paper opacity-0 backdrop-blur transition-[opacity,transform,background-color] duration-300 ease-premium hover:bg-ink/80 group-hover:scale-100 group-hover:opacity-100 focus:scale-100 focus:opacity-100"
              >
                ›
              </button>
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                {images.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ease-premium ${
                      i === index ? "w-4 bg-paper" : "w-1.5 bg-paper/40"
                    }`}
                  />
                ))}
              </div>
            </>
          )}

          {/* Comparar — sempre visível em ecrãs tácteis; com rato aparece
              ao passar por cima. Tocar aqui alterna a comparação;
              tocar na foto (o Link) abre o anúncio. */}
          <div className="absolute bottom-3 right-3 opacity-100 transition-opacity md:can-hover:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
            <CompareButton slug={vehicle.slug} />
          </div>
        </div>
        </ViewTransition>

        <div className="mt-4 px-1 pb-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-lg font-semibold text-paper">
              {vehicle.make} {vehicle.model}
            </h3>
            <p className="whitespace-nowrap text-lg font-semibold text-accent">
              {<VehiclePrice vehicle={vehicle} />}
            </p>
          </div>

          {vehicle.variant && (
            <p className="mt-0.5 text-sm font-light text-paper/60">
              {vehicle.variant}
            </p>
          )}

          {/* Chips de especificações (ano, km, combustível, caixa). */}
          <div className="mt-3 flex flex-wrap gap-2">
            <SpecChip icon={<CalIcon />}>
              {registrationLabel(vehicle.year, vehicle.registrationMonth)}
            </SpecChip>
            <SpecChip icon={<GaugeIcon />}>
              {formatKm(vehicle.mileage)}
            </SpecChip>
            <SpecChip icon={<FuelIcon />}>{vehicle.fuel}</SpecChip>
            <SpecChip icon={<GearIcon />}>{vehicle.transmission}</SpecChip>
          </div>

          {vehicle.location && (
            <p className="mt-3 text-xs text-paper/60">
              Ponto de venda: {vehicle.location}
            </p>
          )}
          {vehicle.warrantyMonths ? (
            <p className="mt-3 text-sm text-paper/60">
              Garantia:{" "}
              <span className="font-semibold text-accent">
                {vehicle.warrantyMonths} meses
              </span>
            </p>
          ) : null}
        </div>
      </Link>
    </article>
  );
}

/** Pílula com ícone + valor para os destaques do card. */
function SpecChip({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-paper/80">
      <span className="text-paper/60">{icon}</span>
      {children}
    </span>
  );
}

const ic = {
  className: "h-3.5 w-3.5",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};
function CalIcon() {
  return (
    <svg {...ic}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v3M16 3v3" />
    </svg>
  );
}
function GaugeIcon() {
  return (
    <svg {...ic}>
      <path d="M12 13l4-3" />
      <path d="M4 18a8 8 0 1116 0" />
    </svg>
  );
}
function FuelIcon() {
  return (
    <svg {...ic}>
      <path d="M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16H5z" />
      <path d="M15 8h2.5A1.5 1.5 0 0119 9.5V16a1.5 1.5 0 003 0V9l-3-3" />
      <path d="M7 9h6" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg {...ic}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </svg>
  );
}
