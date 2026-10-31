"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addWorkshopCost, deleteWorkshopCost } from "@/lib/actions/workshop";
import { formatPrice } from "@/lib/format";
import type { WorkshopCost } from "@/lib/workshop";

const CATEGORIES = [
  { value: "parts", label: "Peças / material" },
  { value: "other", label: "Outros" },
];

/** O dia de hoje em Lisboa (o do stand), não o do relógio de quem abre a página. */
function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
}

/**
 * Registo de peças/material pela oficina. Vai para a mesma tabela dos custos,
 * por isso entra logo nas margens em Custos e margens.
 */
export function WorkshopCostsPanel({
  carId,
  initial,
}: {
  carId: string;
  initial: WorkshopCost[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("parts");
  const [date, setDate] = useState(todayISO());

  const total = initial.reduce((n, c) => n + Number(c.amount), 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const fd = new FormData();
      fd.set("car_id", carId);
      fd.set("category", category);
      fd.set("description", description);
      fd.set("amount", amount);
      fd.set("incurred_on", date);
      const res = await addWorkshopCost(fd);
      if (res.ok) {
        toast.success("Material registado.");
        setDescription("");
        setAmount("");
        router.refresh();
      } else toast.error(res.error ?? "Não foi possível registar.");
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteWorkshopCost(id);
      if (res.ok) {
        toast.success("Registo apagado.");
        router.refresh();
      } else toast.error(res.error ?? "Não foi possível apagar.");
    });
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-paper/50">
        Peças e material
      </h2>
      <p className="mt-1 text-xs text-paper/50">
        Regista aqui o material que foste buscar. Entra automaticamente nos
        custos da viatura.
      </p>

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="field-label">Descrição</span>
          <input
            className="field"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex.: Pastilhas de travão dianteiras"
            maxLength={500}
            required
          />
        </label>
        <label className="block">
          <span className="field-label">Valor (€)</span>
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="field-label">Data</span>
          <input
            className="field"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="field-label">Tipo</span>
          <select
            className="field"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "A registar…" : "Registar material"}
          </button>
        </div>
      </form>

      {initial.length > 0 && (
        <>
          <div className="mt-6 flex items-center gap-3 text-sm">
            <span className="rounded-full bg-white/10 px-3 py-1 text-paper/70">
              {initial.length} {initial.length === 1 ? "registo" : "registos"}
            </span>
            <span className="font-semibold text-accent">
              {formatPrice(total)} em material
            </span>
          </div>
          <ul className="mt-3 divide-y divide-white/10">
            {initial.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-paper">
                    {c.description} · {formatPrice(Number(c.amount))}
                  </p>
                  <p className="text-xs text-paper/50">
                    {CATEGORIES.find((x) => x.value === c.category)?.label ?? c.category} ·{" "}
                    {c.incurred_on}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  disabled={pending}
                  aria-label={`Apagar ${c.description}`}
                  className="shrink-0 rounded-lg px-2 py-1 text-paper/40 transition-colors hover:bg-red-500/10 hover:text-red-300"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
