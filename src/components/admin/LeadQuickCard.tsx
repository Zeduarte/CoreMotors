"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { quickAssign, quickContacted, quickSnooze, type Snooze } from "@/lib/actions/lead-quick";
import { confirmVisit, setVisitOutcome } from "@/lib/actions/visits";

export interface QuickLead {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  phone: string | null;
  whatsapp: string | null;
  email: string;
  carLabel: string | null;
  message: string | null;
  /** Dados do pedido que interessam (já filtrados e com rótulos legíveis). */
  details: { label: string; value: string }[];
  age: string;
  unanswered: boolean;
  assignedTo: string | null;
  assignedName: string | null;
  nextAction: string | null;
  nextActionLabel: string | null;
  overdue: boolean;
  visitLabel: string | null;
  visitStatus: string | null;
  isNew: boolean;
}

const VISIT_STATUS: Record<string, string> = {
  requested: "Por confirmar",
  confirmed: "Confirmada",
  done: "Realizada",
  no_show: "Não compareceu",
  cancelled: "Cancelada",
};

const SNOOZES: { value: Snooze; label: string }[] = [
  { value: "1h", label: "Daqui a 1 hora" },
  { value: "tomorrow", label: "Amanhã às 10:00" },
  { value: "3d", label: "Daqui a 3 dias" },
];

const BTN =
  "inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-paper/80 transition-colors hover:border-accent hover:text-accent disabled:opacity-50";

/**
 * Um contacto na lista, com o que importa à vista (quem é, o que quer, a
 * mensagem, a visita, o que falta fazer) e as ações do dia a dia à mão: ligar,
 * WhatsApp, marcar como contactado, atribuir, adiar e confirmar a visita.
 */
export function LeadQuickCard({
  lead: l,
  staff,
  meId,
}: {
  lead: QuickLead;
  staff: { id: string; name: string }[];
  meId: string;
}) {
  const [pending, start] = useTransition();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!snoozeOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !snoozeRef.current?.contains(e.target as Node)) setSnoozeOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [snoozeOpen]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    start(async () => {
      try {
        const res = await action();
        if (res.ok) toast.success(success);
        else toast.error(res.error ?? "Não foi possível concluir.");
      } catch {
        toast.error("Falha de ligação. Tente novamente.");
      }
    });
  }
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };

  const open = l.status === "new" || l.status === "contacted" || l.status === "proposal";

  return (
    <li className={`card p-4 ${l.isNew ? "border-[color-mix(in_srgb,var(--accent)_40%,transparent)]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/leads/${l.id}`} className="text-base font-semibold text-paper hover:text-accent">
              {l.name}
            </Link>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-paper/60">
              {l.kindLabel}
            </span>
            <span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-2 py-0.5 text-[11px] font-medium text-accent">{l.statusLabel}</span>
            {l.unanswered && (
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">Sem resposta</span>
            )}
            {l.overdue && (
              <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">Em atraso</span>
            )}
          </div>
          {l.carLabel && <p className="mt-1 text-sm text-paper/70">{l.carLabel}</p>}
        </div>
        <span className="shrink-0 text-xs text-paper/40">{l.age}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {l.phone && (
          <a href={`tel:${l.phone}`} className="text-paper/80 hover:text-accent">
            {l.phone}
          </a>
        )}
        {l.email && (
          <a href={`mailto:${l.email}`} className="text-paper/60 hover:text-accent">
            {l.email}
          </a>
        )}
      </div>

      {l.message && <p className="mt-3 line-clamp-3 whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3 text-sm text-paper/75">{l.message}</p>}

      {l.details.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {l.details.map((d, i) => (
            <li key={`${i}-${d.label}`} className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-xs text-paper/70">
              <span className="text-paper/40">{d.label}:</span> {d.value}
            </li>
          ))}
        </ul>
      )}

      {l.visitLabel && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-paper">Visita:</span>
          <span className="text-paper/80">{l.visitLabel}</span>
          {l.visitStatus && (
            <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] text-sky-300">{VISIT_STATUS[l.visitStatus] ?? l.visitStatus}</span>
          )}
        </p>
      )}

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className={l.assignedName ? "text-paper/80" : "text-red-300"}>{l.assignedName ?? "Por atribuir"}</span>
        {l.nextAction && (
          <span className={l.overdue ? "text-amber-300" : "text-paper/60"}>
            {l.nextAction}
            {l.nextActionLabel ? ` · ${l.nextActionLabel}` : ""}
          </span>
        )}
      </p>

      {/* Ações rápidas */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        {l.phone && (
          <a href={`tel:${l.phone}`} className={BTN}>
            Ligar
          </a>
        )}
        {l.whatsapp && (
          <a href={`https://wa.me/${l.whatsapp}`} target="_blank" rel="noopener noreferrer" className={`${BTN} hover:!border-emerald-400 hover:!text-emerald-300`}>
            WhatsApp
          </a>
        )}
        {l.status === "new" && (
          <button type="button" disabled={pending} onClick={() => run(() => quickContacted(l.id), "Marcado como contactado.")} className={`${BTN} !border-[color-mix(in_srgb,var(--accent)_50%,transparent)] !text-accent`}>
            ✓ Já contactei
          </button>
        )}
        {l.visitStatus === "requested" && (
          <button type="button" disabled={pending} onClick={() => run(() => confirmVisit(form({ id: l.id })), "Visita confirmada.")} className={`${BTN} !border-sky-400/50 !text-sky-300`}>
            Confirmar visita
          </button>
        )}
        {l.visitStatus === "confirmed" && (
          <>
            <button type="button" disabled={pending} onClick={() => run(() => setVisitOutcome(form({ id: l.id, status: "done" })), "Visita registada como realizada.")} className={BTN}>
              Visita realizada
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => setVisitOutcome(form({ id: l.id, status: "no_show" })), "Registado: não compareceu.")} className={BTN}>
              Não veio
            </button>
          </>
        )}
        {open && l.assignedTo !== meId && (
          <button type="button" disabled={pending} onClick={() => run(() => quickAssign(l.id, meId), "Atribuído a si.")} className={BTN}>
            Atribuir-me
          </button>
        )}
        {open && (
          <div className="relative" ref={snoozeRef}>
            <button type="button" disabled={pending} onClick={() => setSnoozeOpen((v) => !v)} aria-expanded={snoozeOpen} className={BTN}>
              Adiar ▾
            </button>
            {snoozeOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-white/10 bg-ink-soft shadow-xl">
                {SNOOZES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setSnoozeOpen(false);
                      run(() => quickSnooze(l.id, s.value), "Próxima ação marcada.");
                    }}
                    className="block w-full px-3 py-2 text-left text-xs text-paper/80 hover:bg-white/10"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {open && staff.length > 0 && (
          <select
            aria-label="Atribuir a"
            disabled={pending}
            value={l.assignedTo ?? ""}
            onChange={(e) => run(() => quickAssign(l.id, e.target.value), "Responsável atualizado.")}
            className="rounded-full border border-white/15 bg-transparent px-3 py-1.5 text-xs text-paper/80"
          >
            <option value="">Por atribuir</option>
            {staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <Link href={`/admin/leads/${l.id}`} className="ml-auto text-xs font-medium text-accent hover:underline">
          Abrir →
        </Link>
      </div>
    </li>
  );
}
