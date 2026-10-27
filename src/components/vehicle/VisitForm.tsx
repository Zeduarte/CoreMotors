"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PrivacyNotice } from "@/components/forms/PrivacyNotice";
import {
  getVisitAvailability,
  requestVisit,
  type VisitAvailability,
  type VisitRequestState,
} from "@/lib/actions/visits";
import { visitIcs, visitShortLabel, visitWhenLabel } from "@/lib/visits";

const DAY = new Intl.DateTimeFormat("pt-PT", { timeZone: "UTC", weekday: "short" });
const DATE = new Intl.DateTimeFormat("pt-PT", { timeZone: "UTC", day: "numeric", month: "short" });

/**
 * Marcar visita ao stand: escolher o dia e a hora (só as vagas livres, no
 * horário do stand), e deixar o nome e o telemóvel. Entra como contacto
 * 'visit' — a equipa confirma na agenda e o cliente recebe a confirmação por
 * WhatsApp, se a pediu.
 */
export function VisitForm({
  vehicleId,
  vehicleName,
  companyName,
  address,
  phoneHref,
}: {
  vehicleId: string;
  vehicleName: string;
  companyName: string;
  address: string;
  phoneHref: string;
}) {
  const [availability, setAvailability] = useState<VisitAvailability | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, formAction, pending] = useActionState<VisitRequestState, FormData>(requestVisit, { ok: false });

  useEffect(() => {
    let alive = true;
    getVisitAvailability()
      .then((a) => {
        if (!alive) return;
        setAvailability(a);
        // Abre no primeiro dia com vagas livres.
        setDay(a.days.find((d) => d.slots.some((s) => s.available))?.date ?? null);
      })
      .catch(() => alive && setAvailability({ enabled: false, slotMinutes: 30, days: [] }));
    return () => {
      alive = false;
    };
  }, []);

  // Se a hora escolhida ficou ocupada entretanto, o servidor diz — e volta-se
  // a pedir as vagas.
  useEffect(() => {
    if (state.error && /ocupada/.test(state.error)) {
      setAt(null);
      getVisitAvailability().then(setAvailability).catch(() => {});
    }
  }, [state]);

  const selected = availability?.days.find((d) => d.date === day) ?? null;
  const ics = useMemo(() => {
    if (!state.ok || !state.at) return null;
    const body = visitIcs({
      at: state.at,
      minutes: availability?.slotMinutes ?? 30,
      title: `Visita ao stand — ${vehicleName}`,
      location: `${companyName}, ${address}`,
      description: `Visita para ver o ${vehicleName}. A confirmar pela ${companyName}.`,
      uid: `${state.at}-${vehicleId}@coremotors`,
    });
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
  }, [state, availability, vehicleName, companyName, address, vehicleId]);

  function validate(e: React.FormEvent<HTMLFormElement>) {
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const next: Record<string, string> = {};
    if (!at) next.at = "Escolha a hora da visita.";
    if (!data.name?.trim()) next.name = "Indique o seu nome.";
    if (!/^[\d\s+]{9,}$/.test(data.phone?.trim() ?? "")) next.phone = "Indique um telemóvel válido, para confirmarmos a visita.";
    setErrors(next);
    if (Object.keys(next).length) e.preventDefault();
  }

  if (state.ok && state.at) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-accent/30 bg-accent/10 p-6 text-center"
      >
        <CalendarIcon className="mx-auto h-9 w-9 text-accent" />
        <p className="mt-3 text-lg font-semibold text-paper">Pedido de visita enviado</p>
        <p className="mx-auto mt-3 max-w-xs text-sm text-paper/70">
          Recebemos o pedido para {visitWhenLabel(state.at)}. A equipa confirma a hora consigo por WhatsApp ou
          telefone; só fica marcada depois dessa confirmação.
        </p>
        {ics && (
          <a
            href={ics}
            download="visita-stand.ics"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:border-accent hover:text-accent"
          >
            <CalendarIcon className="h-4 w-4" />
            Guardar na agenda
          </a>
        )}
      </motion.div>
    );
  }

  if (!availability) {
    return (
      <div className="space-y-3" role="status" aria-label="A carregar as horas livres">
        <div className="flex gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 w-16 shrink-0 animate-pulse rounded-2xl bg-white/[0.06]" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-xl bg-white/[0.06]" />
          ))}
        </div>
      </div>
    );
  }

  if (!availability.enabled || !availability.days.length) {
    return (
      <div className="rounded-2xl border border-white/10 p-6 text-center text-sm text-paper/70">
        <p>A marcação online não está disponível de momento.</p>
        <a href={phoneHref} className="mt-3 inline-block font-semibold text-accent">
          Ligue-nos para combinar a visita →
        </a>
      </div>
    );
  }

  return (
    // `min-w-0`: a fila dos dias desliza na horizontal; sem isto alargava a
    // janela inteira até caberem todos.
    <form action={formAction} onSubmit={validate} className="grid min-w-0 gap-5 [&>*]:min-w-0">
      <input type="hidden" name="car_id" value={vehicleId} />
      <input type="hidden" name="at" value={at ?? ""} />

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-paper/45">Dia</p>
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="Dia da visita">
          {availability.days.map((d) => {
            const free = d.slots.some((s) => s.available);
            const active = d.date === day;
            const date = new Date(`${d.date}T12:00:00Z`);
            return (
              <button
                key={d.date}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!free}
                onClick={() => {
                  setDay(d.date);
                  setAt(null);
                }}
                className={`flex w-16 shrink-0 snap-start flex-col items-center rounded-2xl border px-2 py-2.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                  active ? "border-accent bg-accent text-ink" : "border-white/15 text-paper hover:border-accent"
                }`}
              >
                <span className={`text-[11px] uppercase tracking-wide ${active ? "text-ink/70" : "text-paper/50"}`}>
                  {DAY.format(date).replace(".", "")}
                </span>
                <span className="text-sm font-semibold">{DATE.format(date).replace(".", "")}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-paper/45">Hora</p>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Hora da visita">
            {selected.slots.map((s) => (
              <button
                key={s.at}
                type="button"
                role="radio"
                aria-checked={at === s.at}
                disabled={!s.available}
                onClick={() => setAt(s.at)}
                className={`rounded-xl border py-2.5 text-sm font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:border-white/5 disabled:text-paper/25 disabled:line-through ${
                  at === s.at ? "border-accent bg-accent text-ink" : "border-white/15 text-paper hover:border-accent"
                }`}
              >
                {s.time}
              </button>
            ))}
          </div>
          {errors.at && <p className="mt-2 text-xs text-red-400">{errors.at}</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-paper/45">Nome</span>
          <input name="name" autoComplete="name" className="field" placeholder="O seu nome" />
          {errors.name && <span className="mt-1 block text-xs text-red-400">{errors.name}</span>}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-paper/45">Telemóvel</span>
          <input name="phone" type="tel" inputMode="tel" autoComplete="tel" className="field" placeholder="912 345 678" />
          {errors.phone && <span className="mt-1 block text-xs text-red-400">{errors.phone}</span>}
        </label>
      </div>

      <label className="flex items-start gap-3 text-sm text-paper/80">
        <input type="checkbox" name="whatsapp_opt_in" value="yes" defaultChecked className="mt-0.5 shrink-0 accent-[color:var(--accent)]" />
        Receber a confirmação e o lembrete da visita por WhatsApp.
      </label>

      {state.error && (
        <p className="text-sm text-red-400" role="alert">
          {state.error}
        </p>
      )}
      <div className="-my-3">
        <PrivacyNotice />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3.5 text-base font-semibold text-ink transition-transform hover:scale-[1.01] disabled:opacity-60"
      >
        <CalendarIcon className="h-5 w-5" />
        {pending ? "A marcar…" : at ? `Pedir visita · ${visitShortLabel(at)}` : "Pedir visita"}
      </button>
    </form>
  );
}

export function CalendarIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M8 2.5v4M16 2.5v4M3 9.5h18" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" />
    </svg>
  );
}
