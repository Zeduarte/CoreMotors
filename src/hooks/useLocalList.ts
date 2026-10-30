"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Lista de strings (ex.: slugs de viaturas) persistida em `localStorage` e
 * sincronizada entre componentes e separadores.
 *
 * - Não usa cookies nem servidor: são preferências do próprio dispositivo
 *   (favoritos, vistos recentemente), por isso ficam no browser.
 * - Emite um evento (`sf:local-list`) para que todas as instâncias montadas
 *   com a mesma chave reajam de imediato (ex.: o ❤️ no card e o contador no
 *   header). O evento `storage` nativo trata da sincronização entre abas.
 * - Toda a leitura/escrita está protegida com try/catch — em janelas privadas
 *   ou com armazenamento bloqueado, degrada para uma lista vazia sem rebentar.
 */

const EVENT = "sf:local-list";

/**
 * As listas eram guardadas por mundo (`sf:favorites:car`,
 * `sf:favorites:motorcycle`): uma mota guardada nos carros nunca aparecia.
 * Agora há uma lista só; à 1.ª leitura junta as duas antigas (que ficam
 * intactas), para ninguém perder o que já tinha guardado.
 */
export function migrateWorldLists(key: string): void {
  try {
    const storage = window.localStorage;
    if (storage.getItem(key) !== null) return;
    const merged: string[] = [];
    for (const world of ["car", "motorcycle"]) {
      const raw = storage.getItem(`${key}:${world}`);
      const old: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(old))
        for (const x of old) if (typeof x === "string" && !merged.includes(x)) merged.push(x);
    }
    if (merged.length) storage.setItem(key, JSON.stringify(merged));
  } catch {
    // Armazenamento indisponível ou dados estragados — começa vazia.
  }
}

function read(key: string): string[] {
  if (typeof window === "undefined") return [];
  migrateWorldLists(key);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, list: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { key } }));
  } catch {
    // Armazenamento indisponível — ignora silenciosamente.
  }
}

export interface UseLocalList {
  items: string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  add: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** `true` depois da hidratação — evita divergências SSR/cliente. */
  ready: boolean;
}

export function useLocalList(
  baseKey: string,
  options: { max?: number; prepend?: boolean } = {},
): UseLocalList {
  // Uma lista para os dois mundos: cada viatura é identificada pelo slug.
  const key = baseKey;
  const { max, prepend = false } = options;
  const [items, setItems] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  // Hidrata e mantém sincronizado com outras instâncias / abas.
  useEffect(() => {
    setItems(read(key));
    setReady(true);

    const sync = (e: Event) => {
      if (e instanceof CustomEvent && e.detail?.key && e.detail.key !== key) {
        return;
      }
      setItems(read(key));
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [key]);

  const has = useCallback((id: string) => items.includes(id), [items]);

  const add = useCallback(
    (id: string) => {
      const current = read(key).filter((x) => x !== id);
      let next = prepend ? [id, ...current] : [...current, id];
      if (max && next.length > max) {
        next = prepend ? next.slice(0, max) : next.slice(next.length - max);
      }
      write(key, next);
    },
    [key, max, prepend],
  );

  const remove = useCallback(
    (id: string) => {
      write(key, read(key).filter((x) => x !== id));
    },
    [key],
  );

  const toggle = useCallback(
    (id: string) => {
      const current = read(key);
      if (current.includes(id)) remove(id);
      else add(id);
    },
    [key, add, remove],
  );

  const clear = useCallback(() => write(key, []), [key]);

  return { items, has, toggle, add, remove, clear, ready };
}

export const FAVORITES_KEY = "sf:favorites";
export const RECENT_KEY = "sf:recent";
