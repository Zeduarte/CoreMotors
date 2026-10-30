"use client";

import { useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createTimeEntry, deleteTimeEntry } from "@/lib/actions/hours";
import type { HoursEntry } from "@/lib/hours";

function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const h = (n: number) => `${n.toLocaleString("pt-PT")} h`;

/** Formulário para registar uma tarefa que não é numa viatura. */
export function HoursForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function add(formData: FormData) {
    startTransition(async () => {
      const res = await createTimeEntry(formData);
      if (res.ok) {
        toast.success("Horas registadas.");
        formRef.current?.reset();
        router.refresh();
      } else {
        toast.error(res.error ?? "Erro ao registar.");
      }
    });
  }

  return (
    <form ref={formRef} action={add} className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-paper/50">
        Registar horas
      </h2>
      <p className="text-xs text-paper/50">
        Para trabalho que não é numa viatura. As horas feitas numa mota ou carro
        registam-se na Oficina e aparecem aqui sozinhas.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <span className="field-label">Data</span>
          <input name="work_date" type="date" defaultValue={todayISO()} className="field" required />
        </div>
        <div>
          <span className="field-label">Início</span>
          <input name="start_time" type="time" defaultValue={nowHM()} className="field" required />
        </div>
        <div>
          <span className="field-label">Fim</span>
          <input name="end_time" type="time" className="field" />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-paper/70">
        <input type="checkbox" name="overnight" className="h-4 w-4 shrink-0 accent-accent" />
        Terminou no dia seguinte (passou da meia-noite)
      </label>
      <div>
        <span className="field-label">Tarefa</span>
        <textarea
          name="description"
          rows={2}
          required
          maxLength={500}
          placeholder="Ex.: Limpeza da oficina; atendimento a clientes; ida buscar peças…"
          className="field"
        />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "A guardar…" : "Registar"}
      </button>
    </form>
  );
}

/**
 * Lista das horas, por dia. As de viatura ligam à viatura na Oficina (é lá que
 * se corrigem); as outras tarefas apagam-se aqui.
 */
export function HoursList({
  entries,
  people,
  canOpenWorkshop,
  currentUserId,
  isAdmin,
}: {
  entries: HoursEntry[];
  /** Nomes das pessoas, quando se veem as horas de mais do que uma. */
  people?: Record<string, string>;
  canOpenWorkshop: boolean;
  /** Apaga os próprios registos; o administrador, os de todos. */
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    if (!confirm("Apagar este registo de horas?")) return;
    startTransition(async () => {
      const res = await deleteTimeEntry(id);
      if (res.ok) {
        toast.success("Registo apagado.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Erro ao apagar.");
      }
    });
  }

  if (!entries.length) {
    return (
      <div className="card grid place-items-center p-12 text-center">
        <p className="text-3xl">⏱️</p>
        <p className="mt-2 text-sm text-paper/50">Sem horas registadas neste mês.</p>
      </div>
    );
  }

  const days = new Map<string, HoursEntry[]>();
  for (const e of entries) days.set(e.date, [...(days.get(e.date) ?? []), e]);

  return (
    <div className="space-y-5">
      {[...days.entries()].map(([date, list]) => (
        <section key={date}>
          <header className="mb-2 flex items-baseline justify-between gap-3 px-1">
            <h3 className="text-sm font-semibold capitalize text-paper">
              {new Date(`${date}T12:00:00`).toLocaleDateString("pt-PT", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}
            </h3>
            <span className="text-xs text-paper/50">
              {h(Math.round(list.reduce((s, e) => s + e.hours, 0) * 100) / 100)}
            </span>
          </header>
          <ul className="space-y-2">
            {list.map((e) => (
              <li key={`${e.kind}-${e.id}`} className="card flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-sm text-paper/70">
                      {e.start}
                      {e.end ? ` – ${e.end}` : " (em curso)"}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-paper">
                      {h(e.hours)}
                    </span>
                    {e.vehicle &&
                      (canOpenWorkshop ? (
                        <Link
                          href={`/admin/oficina/${e.vehicle.id}`}
                          className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-paper/70 hover:border-accent hover:text-accent"
                        >
                          ⚒ {e.vehicle.label}
                        </Link>
                      ) : (
                        <span className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-paper/70">
                          ⚒ {e.vehicle.label}
                        </span>
                      ))}
                    {people && e.personId && (
                      <span className="text-xs text-paper/50">{people[e.personId] ?? "—"}</span>
                    )}
                    {people && !e.personId && (
                      <span className="text-xs text-paper/50">
                        {e.personName ? `${e.personName} (apagado)` : "Utilizador apagado"}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-paper/60">{e.description}</p>
                </div>
                {e.kind === "other" && (isAdmin || e.personId === currentUserId) && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(e.id)}
                    aria-label="Apagar registo"
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-paper/40 hover:bg-red-500/15 hover:text-red-300"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
