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
 * Seletor do cabeçalho: "Motas" e "Carros" um por cima do outro, sempre os
 * dois à vista — percebe-se logo que é uma escolha e que dá para trocar. O
 * atual em branco sobre um fundo suave, o outro em cinzento e clicável.
 * Empilhados cabem ao lado do logótipo e do menu, mesmo no telemóvel. Não
 * aparece nas páginas comuns aos dois mundos (Sobre, Serviços, Contactos e
 * legais), onde escolher um tipo não muda nada.
 *
 * A troca é uma navegação completa (`<a>`, não `<Link>`): a rota grava o
 * cookie do mundo e volta, o que refaz todas as queries do servidor. Antes de
 * sair, a foto do outro mundo entra por cima da página (o visual do ecrã de
 * entrada) e a página nova abre tapada por ela e revela-se (`WorldArrival`).
 * Um anel com a percentagem mostra que está a carregar.
 */
export function WorldSwitch({ world }: { world: VehicleType }) {
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

  const segment =
    "flex h-[21px] items-center justify-center rounded-md px-2.5 text-[12px] font-medium leading-none transition-colors md:h-6 md:px-3 md:text-[13px]";

  return (
    <>
      <div
        role="group"
        aria-label="Escolher entre motas e carros"
        className="inline-flex shrink-0 flex-col rounded-lg border border-white/15 p-0.5"
      >
        {(["motorcycle", "car"] as const).map((type) => {
          const label = capitalize(WORLD_LABEL[type]);
          return type === world ? (
            <span key={type} aria-current="true" className={`${segment} bg-white/[0.12] text-paper`}>
              {label}
            </span>
          ) : (
            <a
              key={type}
              href={`/api/vehicle-context?area=public&type=${type}&target=${encodeURIComponent(destination)}`}
              onClick={go}
              onPointerEnter={preload}
              onFocus={preload}
              title={`Mudar para o stock de ${WORLD_LABEL[type]}`}
              className={`${segment} text-paper/50 hover:bg-white/5 hover:text-paper`}
            >
              {label}
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
