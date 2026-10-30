"use client";

import { ActionForm, Field } from "./ActionForm";
import { finishWorklog } from "@/lib/actions/operations";
import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createWorklog, deleteWorklog } from "@/lib/actions/workshop";
import type { VehicleTaskRow } from "@/lib/supabase/database.types";

/** "HH:MM:SS" ou "HH:MM" → "HH:MM". */
function hm(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Registo de HORAS por viatura: data (default hoje), início (default = último
 * fim registado) e fim; as horas são calculadas automaticamente.
 */
export function TaskManager({
  carId,
  initial,
  lastEnd,
  manageable = [],
}: {
  carId: string;
  initial: VehicleTaskRow[];
  lastEnd: string | null;
  /** Registos que quem vê pode fechar ou apagar: os seus e os de quem está abaixo. */
  manageable?: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const totalHours = initial.reduce((s, t) => s + Number(t.hours || 0), 0);
  const defaultStart = lastEnd || nowHM();

  function add(formData: FormData) {
    startTransition(async () => {
      const res = await createWorklog(formData);
      if (res.ok) {
        toast.success("Horas registadas.");
        formRef.current?.reset();
        router.refresh();
      } else {
        toast.error(res.error ?? "Erro ao registar.");
      }
    });
  }

  function remove(id: string) {
    if (!confirm("Apagar este registo de horas?")) return;
    startTransition(async () => {
      const res = await deleteWorklog(id);
      if (res.ok) {
        toast.success("Registo apagado.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Erro ao apagar.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Novo registo */}
      <form ref={formRef} action={add} className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-paper/50">
          Registar horas
        </h2>
        <input type="hidden" name="car_id" value={carId} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <span className="field-label">Data</span>
            <input
              name="work_date"
              type="date"
              defaultValue={todayISO()}
              className="field"
              required
            />
          </div>
          <div>
            <span className="field-label">Início</span>
            <input
              name="start_time"
              type="time"
              defaultValue={defaultStart}
              className="field"
              required
            />
          </div>
          <div>
            <span className="field-label">Fim</span>
            <input
              name="end_time"
              type="time"
              defaultValue={nowHM()}
              className="field"
            />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-paper/70">
          <input
            type="checkbox"
            name="overnight"
            className="h-4 w-4 shrink-0 accent-accent"
          />
          Terminou no dia seguinte (trabalho passou da meia-noite)
        </label>
        <div>
          <span className="field-label">Trabalho realizado (opcional)</span>
          <textarea
            name="description"
            rows={2}
            placeholder="Ex.: Mudança de óleo e filtros; revisão de travões…"
            className="field"
          />
        </div>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "A guardar…" : "Registar"}
        </button>
      </form>

      {/* Resumo */}
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-full bg-white/5 px-3 py-1 text-paper/70">
          {initial.length} {initial.length === 1 ? "registo" : "registos"}
        </span>
        <span className="rounded-full bg-accent/15 px-3 py-1 font-medium text-accent">
          {totalHours.toLocaleString("pt-PT")} h no total
        </span>
      </div>

      {/* Lista de registos */}
      {initial.length === 0 ? (
        <div className="card grid place-items-center p-12 text-center">
          <p className="text-3xl">⏱️</p>
          <p className="mt-2 text-sm text-paper/50">
            Ainda não há horas registadas para esta viatura.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {initial.map((t) => (
            <li key={t.id} className="card flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium text-paper">
                    {new Date(t.work_date).toLocaleDateString("pt-PT", {
                      weekday: "short",
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </span>
                  <span className="font-mono text-sm text-paper/70">
                    {hm(t.start_time)}
                    {t.end_time ? ` – ${hm(t.end_time)}` : " (em curso)"}
                  </span>
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                    {Number(t.hours).toLocaleString("pt-PT")} h
                  </span>
                </div>
                {t.description && (
                  <p className="mt-1 text-sm text-paper/60">{t.description}</p>
                )}
              </div>
              {!t.end_time && manageable.includes(t.id) && <ActionForm action={finishWorklog} label="Terminar" className="space-y-2"><input type="hidden" name="id" value={t.id}/><Field label="Hora de fim"><input className="field" type="time" name="end_time" defaultValue={nowHM()} required/></Field><label className="flex cursor-pointer items-center gap-2 text-sm text-paper/70"><input type="checkbox" name="overnight" className="h-4 w-4 shrink-0 accent-accent"/>Terminou no dia seguinte</label></ActionForm>}
              {manageable.includes(t.id) && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(t.id)}
                  aria-label="Apagar registo"
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-paper/40 hover:bg-red-500/15 hover:text-red-300"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
