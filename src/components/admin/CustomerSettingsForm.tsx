"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveCustomerSettings } from "@/lib/actions/customer-settings";
import { WEEKDAY_NAMES, type VisitSchedule } from "@/lib/visits";
import { CUSTOMER_TEMPLATES } from "@/lib/customer-templates";

type DayRow = { open: boolean; from: string; to: string };

/** Segunda primeiro, domingo no fim — como se lê um horário. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];

function toRows(s: VisitSchedule): { rows: DayRow[]; breakFrom: string; breakTo: string } {
  // Dois intervalos no mesmo dia = uma pausa (almoço). Usa-se a do primeiro dia que a tiver.
  let breakFrom = "";
  let breakTo = "";
  const rows = Array.from({ length: 7 }, (_, i) => {
    const list = s.days[String(i)] ?? [];
    if (list.length >= 2 && !breakFrom) {
      breakFrom = list[0]![1];
      breakTo = list[1]![0];
    }
    return list.length
      ? { open: true, from: list[0]![0], to: list[list.length - 1]![1] }
      : { open: false, from: "09:00", to: "19:00" };
  });
  return { rows, breakFrom, breakTo };
}

function toSchedule(rows: DayRow[], breakFrom: string, breakTo: string, base: Omit<VisitSchedule, "days">): VisitSchedule {
  const days: VisitSchedule["days"] = {};
  rows.forEach((r, i) => {
    if (!r.open || r.from >= r.to) {
      days[String(i)] = [];
      return;
    }
    const pause = breakFrom && breakTo && breakFrom < breakTo && breakFrom > r.from && breakTo < r.to;
    days[String(i)] = pause ? [[r.from, breakFrom], [breakTo, r.to]] : [[r.from, r.to]];
  });
  return { ...base, days };
}

export function CustomerSettingsForm({
  initial,
  missing,
}: {
  initial: { visitsEnabled: boolean; schedule: VisitSchedule; customerWhatsApp: boolean };
  /** A migração 0042 ainda não foi aplicada. */
  missing: boolean;
}) {
  const start = toRows(initial.schedule);
  const [pending, startTransition] = useTransition();
  const [visits, setVisits] = useState(initial.visitsEnabled);
  const [rows, setRows] = useState(start.rows);
  const [breakFrom, setBreakFrom] = useState(start.breakFrom);
  const [breakTo, setBreakTo] = useState(start.breakTo);
  const [slot, setSlot] = useState(initial.schedule.slot);
  const [capacity, setCapacity] = useState(initial.schedule.capacity);
  const [notice, setNotice] = useState(initial.schedule.notice_hours);
  const [maxDays, setMaxDays] = useState(initial.schedule.max_days);
  const [whatsapp, setWhatsapp] = useState(initial.customerWhatsApp);

  const setRow = (i: number, patch: Partial<DayRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveCustomerSettings({
        visits_enabled: visits,
        customer_whatsapp: whatsapp,
        visit_schedule: toSchedule(rows, breakFrom, breakTo, {
          slot,
          capacity,
          notice_hours: notice,
          max_days: maxDays,
        }),
      });
      if (res.ok) toast.success("Definições guardadas.");
      else toast.error(res.error ?? "Erro ao guardar.");
    });
  }

  const time = "field !w-auto px-2 py-1.5 text-sm tabular-nums";

  return (
    <form onSubmit={submit} className="card space-y-6 p-5">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-paper/50">Visitas e mensagens aos clientes</h2>
        <p className="mt-1 text-sm text-paper/60">
          A marcação de visitas na ficha das viaturas e os avisos automáticos aos clientes (alertas de stock e confirmação
          das visitas) por WhatsApp.
        </p>
      </div>

      {missing && (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
          Falta aplicar a migração <code>0042_alerts_visits.sql</code> no Supabase (SQL Editor). Até lá, estas definições não
          se guardam e a marcação de visitas fica desligada.
        </p>
      )}

      <fieldset disabled={missing} className="space-y-6 disabled:opacity-60">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={visits} onChange={(e) => setVisits(e.target.checked)} />
          <span>
            <span className="font-medium text-paper">Marcação de visitas no site</span>
            <span className="block text-sm text-paper/55">
              Botão «Marcar visita ao stand» na ficha: o cliente escolhe o dia e a hora livres. Os pedidos entram na Agenda de
              visitas, por confirmar.
            </span>
          </span>
        </label>

        <div className={`space-y-4 rounded-xl border border-white/10 p-4 ${visits ? "" : "opacity-50"}`}>
          <p className="text-sm font-medium text-paper">Horário das visitas</p>
          <div className="space-y-2">
            {ORDER.map((i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex w-28 items-center gap-2">
                  <input type="checkbox" checked={rows[i]!.open} onChange={(e) => setRow(i, { open: e.target.checked })} />
                  {WEEKDAY_NAMES[i]}
                </label>
                {rows[i]!.open ? (
                  <span className="flex items-center gap-2">
                    <input type="time" step={900} className={time} value={rows[i]!.from} onChange={(e) => setRow(i, { from: e.target.value })} aria-label={`${WEEKDAY_NAMES[i]}: abre`} />
                    <span className="text-paper/40">às</span>
                    <input type="time" step={900} className={time} value={rows[i]!.to} onChange={(e) => setRow(i, { to: e.target.value })} aria-label={`${WEEKDAY_NAMES[i]}: fecha`} />
                  </span>
                ) : (
                  <span className="text-paper/40">Fechado</span>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 text-sm">
            <span className="text-paper/70">Pausa para almoço (opcional)</span>
            <input type="time" step={900} className={time} value={breakFrom} onChange={(e) => setBreakFrom(e.target.value)} aria-label="Pausa: início" />
            <span className="text-paper/40">às</span>
            <input type="time" step={900} className={time} value={breakTo} onChange={(e) => setBreakTo(e.target.value)} aria-label="Pausa: fim" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm">
              <span className="mb-1 block text-paper/70">Duração de cada visita</span>
              <select className="field" value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
                {[15, 20, 30, 45, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {m} minutos
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-paper/70">Visitas à mesma hora</span>
              <input type="number" min={1} max={20} className="field" value={capacity} onChange={(e) => setCapacity(Number(e.target.value) || 1)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-paper/70">Antecedência mínima (horas)</span>
              <input type="number" min={0} max={72} className="field" value={notice} onChange={(e) => setNotice(Number(e.target.value) || 0)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-paper/70">Marcar até (dias)</span>
              <input type="number" min={1} max={90} className="field" value={maxDays} onChange={(e) => setMaxDays(Number(e.target.value) || 21)} />
            </label>
          </div>
        </div>

        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />
          <span>
            <span className="font-medium text-paper">Enviar mensagens automáticas aos clientes por WhatsApp</span>
            <span className="block text-sm text-paper/55">
              Só a quem o pediu no formulário. Quando entra uma viatura compatível com um alerta de stock, o cliente recebe o
              link; quando a equipa confirma uma visita, recebe a confirmação (e um lembrete na véspera). Desligado, a equipa
              vê o que há para avisar e envia com um toque, do seu WhatsApp.
            </span>
          </span>
        </label>

        <details className="rounded-xl border border-white/10 p-4 text-sm">
          <summary className="cursor-pointer font-medium text-paper">
            Antes de ligar: criar os 4 modelos no WhatsApp Manager
          </summary>
          <p className="mt-3 text-paper/60">
            A Meta só deixa a empresa iniciar conversas com modelos aprovados. Crie estes quatro na conta do número ligado
            (Modelos de mensagem → Criar modelo · idioma Portuguese (POR) · sem cabeçalho nem botões), com o texto exato.
            Os passos estão em <code>docs/WHATSAPP_TEMPLATES.md</code>.
          </p>
          {Object.values(CUSTOMER_TEMPLATES).map((t) => (
            <div key={t.name} className="mt-4">
              <p className="font-mono text-xs text-accent">{t.name}</p>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-ink p-3 text-xs text-paper/80">{t.body}</pre>
            </div>
          ))}
        </details>
      </fieldset>

      <button type="submit" className="btn-primary" disabled={pending || missing}>
        {pending ? "A guardar…" : "Guardar"}
      </button>
    </form>
  );
}
