"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { markCarSold } from "@/lib/actions/cars";

export interface SellTarget {
  id: string;
  label: string;
  /** Preço anunciado: sugestão para o preço de venda. */
  price: number | null;
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());

/**
 * «Vendida» sem contacto (venda ao balcão): pede o preço e a data, como o
 * «Concluir venda» do contacto, para a margem nos Custos ficar certa.
 */
export function SellVehicleDialog({ car, onClose }: { car: SellTarget; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState(car.price ? String(car.price) : "");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount.replace(/\s/g, "").replace(",", "."));
    if (!(value > 0)) return setError("Indique o preço de venda.");
    if (!date) return setError("Indique a data da venda.");
    setError(null);
    start(async () => {
      const r = await markCarSold(car.id, value, date);
      if (!r.ok) {
        setError(r.error ?? "Não foi possível marcar como vendida.");
        return;
      }
      toast.success(`${car.label} marcada como vendida.`);
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && !pending && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="sell-title"
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-ink-muted p-6 text-paper shadow-2xl"
      >
        <div>
          <h2 id="sell-title" className="text-lg font-semibold">
            Marcar como vendida
          </h2>
          <p className="mt-1 text-sm text-paper/60">
            {car.label} — o preço e a data ficam nos Custos e margens. A viatura sai do site e dos portais.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="field-label">Preço de venda (€)</span>
            <input
              ref={first}
              className="field mt-1"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            <span className="field-label">Data da venda</span>
            <input
              type="date"
              className="field mt-1"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "A gravar…" : "Marcar como vendida"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Botão para a ficha da viatura no backoffice. */
export function SellVehicleButton({ car }: { car: SellTarget }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        Marcar como vendida
      </button>
      {open && <SellVehicleDialog car={car} onClose={() => setOpen(false)} />}
    </>
  );
}
