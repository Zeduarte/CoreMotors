"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useVehicleWorld } from "@/components/site/VehicleWorld";
const MAX = 3;


interface CompareCtx {
  slugs: string[];
  has: (slug: string) => boolean;
  toggle: (slug: string) => void;
  remove: (slug: string) => void;
  clear: () => void;
  full: boolean;
}

const Ctx = createContext<CompareCtx | null>(null);

/** Estado global (persistido em localStorage) das viaturas a comparar. */
export function CompareProvider({ children }: { children: React.ReactNode }) {
  const KEY = `coremotors:compare:${useVehicleWorld()}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [slugs, setSlugs] = useState<string[]>([]);

  // Hidrata do localStorage no cliente.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setSlugs(Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string").slice(0, MAX) : []);
    } catch {
      /* ignora */
    }
    setLoadedKey(KEY);
  }, [KEY]);

  useEffect(() => {
    if (loadedKey !== KEY) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(slugs));
    } catch {
      /* ignora */
    }
  }, [slugs, KEY, loadedKey]);

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

export const COMPARE_MAX = MAX;
