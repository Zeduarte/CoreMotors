"use client";

import { useState, useTransition } from "react";
import { cancelStockAlert } from "@/lib/actions/alerts";

export function CancelAlertButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  if (result?.ok) {
    return <p className="mt-6 rounded-2xl border border-accent/30 bg-accent/10 p-4 text-sm text-paper">Alerta cancelado. Não volta a receber estes avisos.</p>;
  }
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await cancelStockAlert(token)))}
        className="mt-6 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink transition-transform hover:scale-[1.02] disabled:opacity-60"
      >
        {pending ? "A cancelar…" : "Cancelar o alerta"}
      </button>
      {result?.error && <p className="mt-3 text-sm text-red-400">{result.error}</p>}
    </>
  );
}
