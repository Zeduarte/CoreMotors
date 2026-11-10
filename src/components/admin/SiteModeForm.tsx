"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSiteMode } from "@/lib/actions/settings";
import { SITE_MODES, type SiteMode } from "@/lib/site-types";

/**
 * Definições → Tipo de site. Três opções grandes, como num seletor de plano:
 * só carros, carros e motas, ou só motas.
 */
export function SiteModeForm({ initial }: { initial: SiteMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<SiteMode>(initial);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const r = await saveSiteMode(mode);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível guardar.");
        return;
      }
      toast.success("Tipo de site guardado.");
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4 p-5">
      <div role="group" aria-label="Tipo de site" className="grid gap-3 sm:grid-cols-3">
        {SITE_MODES.map((m) => {
          const on = m.value === mode;
          return (
            <button
              key={m.value}
              type="button"
              aria-pressed={on}
              onClick={() => setMode(m.value)}
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
                {m.label}
              </span>
              <span className="mt-1 block text-xs text-paper/55">{m.hint}</span>
            </button>
          );
        })}
      </div>
      {mode !== "carros-motas" && (
        <p className="text-xs text-paper/50">
          {mode === "carros" ? "As motas já registadas deixam de aparecer no site" : "Os carros já registados deixam de aparecer no site"}{" "}
          e já não se criam novos. No backoffice continuam visíveis, para acabar contactos, oficina e vendas e
          retirar anúncios dos portais. Voltam ao site se escolher «Carros e motas».
        </p>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={pending || mode === initial} className="btn-primary">
          {pending ? "A guardar…" : "Guardar tipo de site"}
        </button>
      </div>
    </div>
  );
}
