"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  chooseOlxCategory,
  disconnectOlx,
  loadOlxCategories,
  syncOlxNow,
  type OlxActionResult,
} from "@/lib/actions/olx";
import { readOlxAdverts } from "@/lib/actions/olx-adverts";
import type { OlxCategory } from "@/lib/olx/categories";

export function OlxActions({ configured, connected }: { configured: boolean; connected: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [candidates, setCandidates] = useState<OlxActionResult["candidates"]>({});

  const run = (fn: () => Promise<OlxActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Feito.");
      else toast.error(r.error ?? "Não foi possível.");
      if (r.candidates) setCandidates(r.candidates);
      router.refresh();
    });

  if (!configured) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {/* Um link e não uma ação: o OAuth é uma navegação até ao OLX e volta. */}
        <a href="/api/olx/connect" className="btn-primary">
          {connected ? "Voltar a ligar a conta OLX" : "Ligar conta OLX"}
        </a>
        {connected && (
          <>
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(loadOlxCategories)}>
              Carregar categorias
            </button>
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(syncOlxNow)}>
              Sincronizar agora
            </button>
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(readOlxAdverts)}>
              Ler anúncios do OLX
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => {
                if (confirm("Desligar a conta do OLX? Os anúncios já publicados continuam lá."))
                  run(disconnectOlx);
              }}
            >
              Desligar
            </button>
          </>
        )}
      </div>

      {(["car", "motorcycle"] as const).map((t) => {
        const lista: OlxCategory[] = candidates?.[t] ?? [];
        if (!lista.length) return null;
        return (
          <form
            key={t}
            className="flex flex-wrap items-end gap-2"
            action={(data) => run(() => chooseOlxCategory(data))}
          >
            <input type="hidden" name="vehicle_type" value={t} />
            <label className="text-sm">
              <span className="mb-1 block text-paper/70">
                Categoria para {t === "car" ? "carros" : "motas"}
              </span>
              <select name="category_id" className="field">
                {lista.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (ID {c.id})
                  </option>
                ))}
              </select>
            </label>
            <button className="btn-ghost" disabled={pending}>
              Usar esta
            </button>
          </form>
        );
      })}
    </div>
  );
}
