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

/** Já se mostrou o destaque do seletor (só uma vez por browser). */
const HINT_KEY = "engineline_world_hint";

/**
 * O cabeçalho tem dois seletores (computador e telemóvel; um deles escondido).
 * A decisão de brilhar é tomada uma vez por carregamento e vale para os dois
 * — senão o primeiro a montar (às vezes o escondido) ficava com ela.
 */
let hintThisLoad: boolean | null = null;
function firstVisitHint(): boolean {
  if (hintThisLoad === null) {
    try {
      hintThisLoad = !localStorage.getItem(HINT_KEY);
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      hintThisLoad = false;
    }
  }
  return hintThisLoad;
}

/**
 * Seletor "Motas | Carros": os dois mundos lado a lado, o atual preenchido na
 * cor do site e o outro clicável — o visitante vê logo que há os dois e em
 * qual está. Não aparece nas páginas comuns aos dois mundos (Sobre, Serviços,
 * Contactos e legais), onde escolher um tipo não muda nada.
 *
 *  - `header`: no cabeçalho. No telemóvel o mundo atual leva o nome e o outro
 *    só o ícone (cabe ao lado do logótipo e do menu). Na primeira visita
 *    brilha uns segundos, para se dar por ele.
 *  - `hero`: maior, no topo da página inicial.
 *
 * A troca é uma navegação completa (`<a>`, não `<Link>`): a rota grava o
 * cookie do mundo e volta, o que refaz todas as queries do servidor. Antes de
 * sair, a foto do outro mundo entra por cima da página (o visual do ecrã de
 * entrada) e a página nova abre tapada por ela e revela-se (`WorldArrival`).
 * Um anel com a percentagem mostra que está a carregar.
 */
export function WorldSwitch({
  world,
  variant = "header",
}: {
  world: VehicleType;
  variant?: "header" | "hero";
}) {
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);
  const [hint, setHint] = useState(false);
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

  // Primeira visita: o seletor do cabeçalho brilha ~4 s, uma única vez.
  useEffect(() => {
    if (variant !== "header" || prefersReducedMotion() || !firstVisitHint()) return;
    const on = window.setTimeout(() => setHint(true), 900);
    const off = window.setTimeout(() => {
      setHint(false);
      hintThisLoad = false;
    }, 900 + 4200);
    return () => {
      window.clearTimeout(on);
      window.clearTimeout(off);
    };
  }, [variant]);

  if (!pathHasWorld(pathname)) return null;

  const target = otherWorld(world);
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

  const hero = variant === "hero";
  const segment = hero
    ? "inline-flex h-11 items-center gap-2 rounded-full px-5 text-base font-semibold md:h-12 md:px-6"
    : "inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-sm font-semibold min-[360px]:px-2.5 md:h-9 md:px-4";

  return (
    <>
      <div
        role="group"
        aria-label="Escolher entre motas e carros"
        className={`relative inline-flex shrink-0 items-center rounded-full border p-1 ${
          hero
            ? "border-white/20 bg-ink/55 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)] backdrop-blur-md"
            : "border-white/15 bg-white/[0.04]"
        } ${hint ? "world-hint" : ""}`}
      >
        {(["motorcycle", "car"] as const).map((type) => {
          const label = capitalize(WORLD_LABEL[type]);
          const icon = type === "motorcycle" ? <MotoIcon big={hero} /> : <CarIcon big={hero} />;
          // No cabeçalho do telemóvel, o mundo de destino fica só com o ícone.
          const text = <span className={!hero && type !== world ? "sr-only md:not-sr-only" : ""}>{label}</span>;
          return type === world ? (
            <span key={type} aria-current="true" className={`${segment} bg-accent text-ink`}>
              {icon}
              {text}
            </span>
          ) : (
            <a
              key={type}
              href={`/api/vehicle-context?area=public&type=${type}&target=${encodeURIComponent(destination)}`}
              onClick={go}
              onPointerEnter={preload}
              onFocus={preload}
              title={`Mudar para o stock de ${WORLD_LABEL[type]}`}
              className={`${segment} text-paper/75 transition-colors hover:bg-white/10 hover:text-paper`}
            >
              {icon}
              {text}
            </a>
          );
        })}
      </div>
      {leaving &&
        createPortal(
          <div ref={overlay} className={`${worldCoverStyles.overlay} ${worldCoverStyles.depart}`} role="status">
            <span className="sr-only">A mudar para {WORLD_LABEL[target]}…</span>
            <WorldCoverArt type={target} />
          </div>,
          document.body,
        )}
    </>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const stroke = (big?: boolean) => ({
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  className: big ? "h-5 w-5" : "h-[18px] w-[18px]",
  "aria-hidden": true,
});

function CarIcon({ big }: { big?: boolean }) {
  return (
    <svg {...stroke(big)}>
      <path d="M3 13l2-5a2 2 0 012-1.5h10A2 2 0 0119 8l2 5v5h-3M6 18H3v-5M6 18a1.5 1.5 0 003 0M15 18a1.5 1.5 0 003 0M6 18h9M3 13h18" />
    </svg>
  );
}

function MotoIcon({ big }: { big?: boolean }) {
  return (
    <svg {...stroke(big)}>
      <circle cx="5" cy="17" r="3" />
      <circle cx="19" cy="17" r="3" />
      <path d="M8 17h6l3-6h-4l-2-3H8M14 8h3" />
    </svg>
  );
}
