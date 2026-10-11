"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import type { VehicleType } from "@/lib/vehicle-categories";
import { WORLD_LABEL, otherWorld, pathHasWorld } from "@/lib/world";
import { asset } from "@/lib/asset";
import { mediaFor } from "@/lib/media";
import { markWorldArrival, prefersReducedMotion, runWorldProgress } from "@/lib/world-arrival";
import { WorldCoverArt, worldCoverStyles } from "./WorldCover";

/** Quanto dura a entrada do outro mundo antes de mudar de página. */
const DEPART_MS = 800;

/**
 * Passagem para o outro mundo (carros ↔ motas).
 *
 * Mostra apenas o destino — quem está nos carros vê "Ver stock de motas". Não
 * aparece nas páginas comuns aos dois mundos (Sobre, Serviços, Contactos e
 * legais), onde escolher um tipo não muda nada.
 *
 * É uma navegação completa (`<a>`, não `<Link>`): a rota grava o cookie do
 * mundo e volta, o que refaz todas as queries do servidor. Antes de sair, a
 * foto do outro mundo entra por cima da página (o visual do ecrã de entrada)
 * e a página nova abre tapada por ela e revela-se (`WorldArrival`). Um anel com
 * a percentagem mostra que está a carregar enquanto o servidor responde.
 */
export function WorldSwitch({
  world,
  compact = false,
}: {
  world: VehicleType;
  /** Versão curta ("Motas"), para o header em ecrãs pequenos. */
  compact?: boolean;
}) {
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);

  // Voltar atrás para esta página (cache do browser) não pode ficar tapado.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setLeaving(false);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // O anel de progresso anda enquanto o browser espera pela página nova.
  useEffect(() => {
    if (!leaving) return;
    return runWorldProgress(overlay.current, startedAt.current);
  }, [leaving]);

  if (!pathHasWorld(pathname)) return null;

  const target = otherWorld(world);
  const label = WORLD_LABEL[target];
  // Numa ficha de viatura o slug é do mundo atual — volta ao stock.
  const destination = pathname.startsWith("/viaturas/") ? "/inventario" : pathname;

  // A foto do outro mundo começa a carregar antes do clique.
  const preload = () => {
    new Image().src = asset(mediaFor(target).entrada);
  };

  function go(e: MouseEvent<HTMLAnchorElement>) {
    // Abrir noutro separador ou "reduzir movimento": navegação normal.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (prefersReducedMotion()) return;
    e.preventDefault();
    const href = e.currentTarget.href;
    startedAt.current = Date.now();
    markWorldArrival(target, startedAt.current);
    setLeaving(true);
    window.setTimeout(() => window.location.assign(href), DEPART_MS);
  }

  return (
    <>
    <a
      href={`/api/vehicle-context?area=public&type=${target}&target=${encodeURIComponent(destination)}`}
      onClick={go}
      onPointerEnter={preload}
      onFocus={preload}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-paper/60 transition-colors hover:border-accent hover:text-accent"
      title={`Mudar para o stock de ${label}`}
    >
      {target === "motorcycle" ? <MotoIcon /> : <CarIcon />}
      {compact ? capitalize(label) : `Ver stock de ${label}`}
    </a>
    {leaving &&
      createPortal(
        <div ref={overlay} className={`${worldCoverStyles.overlay} ${worldCoverStyles.depart}`} role="status">
          <span className="sr-only">A mudar para {label}…</span>
          <WorldCoverArt type={target} />
        </div>,
        document.body,
      )}
    </>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  className: "h-3.5 w-3.5",
  "aria-hidden": true,
};

function CarIcon() {
  return (
    <svg {...stroke}>
      <path d="M3 13l2-5a2 2 0 012-1.5h10A2 2 0 0119 8l2 5v5h-3M6 18H3v-5M6 18a1.5 1.5 0 003 0M15 18a1.5 1.5 0 003 0M6 18h9M3 13h18" />
    </svg>
  );
}

function MotoIcon() {
  return (
    <svg {...stroke}>
      <circle cx="5" cy="17" r="3" />
      <circle cx="19" cy="17" r="3" />
      <path d="M8 17h6l3-6h-4l-2-3H8M14 8h3" />
    </svg>
  );
}
