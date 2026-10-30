"use client";

import { createContext, useContext } from "react";
import { DEFAULT_BADGES, type BadgeDef } from "@/lib/badges";

/**
 * As etiquetas configuradas em Definições chegam a todos os cards do site
 * por aqui, sem ter de as passar a cada lista de viaturas.
 *
 * `now` é a hora do render no servidor, para a etiqueta «Novidade» (até 14
 * dias): servidor e browser usam a MESMA hora. Com `Date.now()` em cada lado
 * (e páginas guardadas na CDN até dias), o cartão podia sair com a etiqueta
 * no HTML e sem ela no browser — erro de hidratação (#418).
 */
const Ctx = createContext<{ badges: BadgeDef[]; now: number | null }>({
  badges: DEFAULT_BADGES,
  now: null,
});

export function BadgesProvider({
  badges,
  now,
  children,
}: {
  badges: BadgeDef[];
  now: number;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={{ badges, now }}>{children}</Ctx.Provider>;
}

export function useBadges(): BadgeDef[] {
  return useContext(Ctx).badges;
}

/** A hora de referência das etiquetas (a do servidor, quando há). */
export function useBadgeNow(): number | undefined {
  return useContext(Ctx).now ?? undefined;
}
