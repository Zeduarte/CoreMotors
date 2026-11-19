"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSiteTheme } from "@/lib/actions/gestao";
import type { ThemeId } from "@/themes/index";

/** Gestão → Versão do site: um cartão por tema (Core, Core2). */
export function SiteThemeForm({
  initial,
  themes,
}: {
  initial: ThemeId;
  themes: { id: ThemeId; label: string; description: string }[];
}) {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemeId>(initial);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const r = await saveSiteTheme(theme);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível guardar.");
        return;
      }
      toast.success("Versão do site guardada. O site público já usa a nova versão.");
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4 p-5">
      <div role="group" aria-label="Versão do site" className="grid gap-3 sm:grid-cols-2">
        {themes.map((t) => {
          const on = t.id === theme;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTheme(t.id)}
              className={`rounded-2xl border p-4 text-left transition-colors ${
                on
                  ? "border-[color:var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <span className="flex items-center gap-2 font-semibold text-paper">
                <span
                  aria-hidden
                  className={`grid h-4 w-4 place-items-center rounded-full border ${
                    on ? "border-[color:var(--accent)]" : "border-white/20"
                  }`}
                >
                  {on && <span className="h-2 w-2 rounded-full bg-accent" />}
                </span>
                {t.label}
                {t.id === initial && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-paper/60">
                    Em uso
                  </span>
                )}
              </span>
              <span className="mt-1 block text-xs text-paper/55">{t.description}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a href="/" target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
          Ver o site ↗
        </a>
        <button type="button" onClick={save} disabled={pending || theme === initial} className="btn-primary">
          {pending ? "A guardar…" : "Guardar versão"}
        </button>
      </div>
    </div>
  );
}
