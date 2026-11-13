"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { migrateWorldLists } from "@/hooks/useLocalList";
const MAX = 3;
// Uma lista para os dois mundos (antes, uma por mundo — ver migrateWorldLists).
const KEY = "coremotors:compare";


interface CompareCtx {
  slugs: string[];
  has: (slug: string) => boolean;
  toggle: (slug: string) => void;
  remove: (slug: string) => void;
  clear: () => void;
  full: boolean;
}

const Ctx = createContext<CompareCtx | null>(null);

/**
 * Estado global (persistido em localStorage) das viaturas a comparar.
 *
 * `available`: as viaturas que o site mostra agora (à venda, reservadas e
 * vendidas). As outras saem da lista — uma viatura retirada, ou de um tipo
 * que o site deixou de vender, contava na barra («2 a comparar») mas a
 * página /comparar já não a encontrava, e não se conseguia tirar.
 */
export function CompareProvider({
  children,
  available,
}: {
  children: React.ReactNode;
  available?: string[];
}) {
  const [loaded, setLoaded] = useState(false);
  const [slugs, setSlugs] = useState<string[]>([]);
  const valid = useMemo(() => (available ? new Set(available) : null), [available]);

  // Tira as que já não estão no site (também depois de o site mudar).
  useEffect(() => {
    if (!loaded || !valid) return;
    setSlugs((prev) => (prev.every((s) => valid.has(s)) ? prev : prev.filter((s) => valid.has(s))));
  }, [loaded, valid]);

  // Hidrata do localStorage no cliente.
  useEffect(() => {
    try {
      migrateWorldLists(KEY);
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setSlugs(Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string").slice(0, MAX) : []);
    } catch {
      /* ignora */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(slugs));
    } catch {
      /* ignora */
    }
  }, [slugs, loaded]);

  const value = useMemo<CompareCtx>(
    () => ({
      slugs,
      has: (slug) => slugs.includes(slug),
      toggle: (slug) =>
        setSlugs((prev) =>
          prev.includes(slug)
            ? prev.filter((s) => s !== slug)
            : prev.length >= MAX
              ? prev
              : [...prev, slug],
        ),
      remove: (slug) => setSlugs((prev) => prev.filter((s) => s !== slug)),
      clear: () => setSlugs([]),
      full: slugs.length >= MAX,
    }),
    [slugs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompare(): CompareCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCompare fora do CompareProvider");
  return ctx;
}

/** Como `useCompare`, mas `null` fora do provider (páginas renderizadas à parte). */
export function useCompareIfAny(): CompareCtx | null {
  return useContext(Ctx);
}

export const COMPARE_MAX = MAX;
