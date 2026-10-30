"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Leitura imediata da preferência, para os efeitos que montam animações.
 *
 * Na hidratação o hook devolve `false` (o valor do servidor) e só depois o
 * valor real — os efeitos dessa primeira passagem correriam com `false` e
 * montavam o Lenis/GSAP para logo a seguir os desmontar. Os efeitos juntam
 * por isso esta leitura ao valor do hook: `prefersReduced || prefersReducedMotionNow()`.
 */
export function prefersReducedMotionNow(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches;
}

/**
 * Fonte da verdade para acessibilidade de movimento.
 *
 * Devolve `true` quando o utilizador pediu menos movimento. No servidor (e na
 * hidratação) é `false`, para o HTML coincidir; no cliente acompanha a
 * preferência, incluindo mudanças com a página aberta. Todos os hooks de
 * animação consultam este valor para, quando ativo, saltar para o estado final.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotionNow, () => false);
}
