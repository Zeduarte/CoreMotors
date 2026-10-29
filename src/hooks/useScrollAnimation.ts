"use client";

import { useRef } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect";
import { prefersReducedMotionNow, usePrefersReducedMotion } from "./usePrefersReducedMotion";

type Cleanup = void | (() => void);

/**
 * Setup: recebe o elemento raiz e um contexto GSAP já criado. Regista aqui os
 * teus tweens/ScrollTriggers. Devolver uma função de limpeza é opcional — o
 * `gsap.context` trata da reversão automática dos tweens criados no seu scope.
 */
export type ScrollSetup<T extends HTMLElement> = (
  root: T,
  ctx: gsap.Context,
) => Cleanup;

/**
 * Hook central de animação de scroll.
 *
 * Encapsula três preocupações que, de outra forma, se repetiriam em cada
 * componente:
 *  1. `gsap.context()` com scope no elemento — limpeza determinística e
 *     seletores relativos (evita colisões de classes entre instâncias).
 *  2. `prefers-reduced-motion`: quando ativo, o setup nunca corre e o conteúdo
 *     fica no seu estado final (o CSS já o mostra visível por defeito).
 *  3. Isomorfismo SSR via `useIsomorphicLayoutEffect`.
 *
 * Devolve a ref a colocar no elemento raiz.
 */
export function useScrollAnimation<T extends HTMLElement = HTMLDivElement>(
  setup: ScrollSetup<T>,
  deps: React.DependencyList = [],
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  const prefersReduced = usePrefersReducedMotion();

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced || prefersReducedMotionNow()) return;

    let userCleanup: Cleanup;
    const ctx = gsap.context((self) => {
      userCleanup = setup(el, self);
    }, el);

    return () => {
      if (typeof userCleanup === "function") userCleanup();
      ctx.revert();
    };
    // ScrollTrigger.refresh é gerido globalmente pelo LenisProvider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefersReduced, ...deps]);

  return ref;
}

export { ScrollTrigger };
