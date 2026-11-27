"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveHomeLayout } from "@/lib/actions/gestao";
import { SECTION_INFO, type HomeLayoutItem, type HomeSection, type ThemeId } from "@/themes/index";

export interface HomeLayoutTheme {
  id: ThemeId;
  label: string;
  /** As do cimo, sempre visíveis (só para mostrar). */
  fixed: HomeSection[];
  /** A lista guardada (ou a de origem). */
  items: HomeLayoutItem[];
  /** A de origem, para «Repor». */
  defaults: HomeLayoutItem[];
}

const same = (a: HomeLayoutItem[], b: HomeLayoutItem[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i]!.id && x.on === b[i]!.on);

/**
 * Gestão → Página inicial: para cada versão (um separador por tema), as
 * secções da página inicial — ligar/desligar e mudar a ordem com as setas.
 * O topo (e no Core3 os cartões das categorias) fica sempre no cimo.
 */
export function HomeLayoutForm({ themes, initialTheme }: { themes: HomeLayoutTheme[]; initialTheme: ThemeId }) {
  const router = useRouter();
  const [tab, setTab] = useState<ThemeId>(initialTheme);
  const [lists, setLists] = useState<Record<string, HomeLayoutItem[]>>(() =>
    Object.fromEntries(themes.map((t) => [t.id, t.items])),
  );
  const [pending, start] = useTransition();
  const current = themes.find((t) => t.id === tab) ?? themes[0]!;
  const items = lists[current.id]!;
  const changed = !same(items, current.items);

  const update = (next: HomeLayoutItem[]) => setLists((prev) => ({ ...prev, [current.id]: next }));
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    update(next);
  };
  const toggle = (i: number) => update(items.map((x, j) => (j === i ? { ...x, on: !x.on } : x)));

  function save() {
    start(async () => {
      const r = await saveHomeLayout(current.id, items);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível guardar.");
        return;
      }
      toast.success(`Página inicial do ${current.label} guardada.`);
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4 p-5">
      <div role="tablist" aria-label="Versão" className="inline-flex gap-1 rounded-full border border-white/10 p-1">
        {themes.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
              t.id === tab ? "bg-paper text-ink" : "text-paper/65 hover:text-paper"
            }`}
          >
            {t.label}
            {!same(lists[t.id]!, t.items) && <span className="ml-1 text-accent">•</span>}
          </button>
        ))}
      </div>

      <ol className="divide-y divide-white/10 rounded-xl border border-white/10">
        {current.fixed.map((id) => (
          <li key={id} className="flex items-center gap-3 px-4 py-3 text-paper/50">
            <span aria-hidden className="w-16 text-center text-xs">fixo</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{SECTION_INFO[id].label}</span>
              <span className="block text-xs">{SECTION_INFO[id].hint}</span>
            </span>
          </li>
        ))}
        {items.map((item, i) => {
          const info = SECTION_INFO[item.id];
          return (
            <li key={item.id} className={`flex items-center gap-3 px-4 py-3 ${item.on ? "" : "opacity-55"}`}>
              <span className="flex w-16 shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Subir ${info.label}`}
                  className="grid h-7 w-7 place-items-center rounded-md border border-white/15 text-paper/70 hover:text-paper disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1}
                  aria-label={`Descer ${info.label}`}
                  className="grid h-7 w-7 place-items-center rounded-md border border-white/15 text-paper/70 hover:text-paper disabled:opacity-30"
                >
                  ↓
                </button>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-paper">{info.label}</span>
                <span className="block text-xs text-paper/50">{info.hint}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={item.on}
                aria-label={`Mostrar ${info.label}`}
                onClick={() => toggle(i)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${item.on ? "bg-accent" : "bg-white/15"}`}
              >
                <span
                  aria-hidden
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${item.on ? "left-[1.375rem]" : "left-0.5"}`}
                />
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => update(current.defaults)}
          disabled={same(items, current.defaults)}
          className="text-sm text-paper/60 hover:text-paper disabled:opacity-40"
        >
          Repor a ordem de origem
        </button>
        <button type="button" onClick={save} disabled={pending || !changed} className="btn-primary">
          {pending ? "A guardar…" : `Guardar ${current.label}`}
        </button>
      </div>
    </div>
  );
}
