"use client";

import { csvCell } from "@/lib/operations";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  deleteLead,
  saveLeadNotes,
  setLeadStatus,
} from "@/lib/actions/leads";
import { LeadStatusBadge } from "./StatusBadge";
import type { LeadKind, LeadStatus } from "@/lib/supabase/database.types";

interface Lead {
  id: string;
  kind: LeadKind;
  status: LeadStatus;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  car_label: string | null;
  preferred_date: string | null;
  notes: string | null;
  car_details: Record<string, unknown>;
  created_at: string;
}

const KIND_LABEL: Record<LeadKind, string> = {
  contact: "Contacto",
  test_drive: "Test drive",
  finance: "Financiamento",
  trade_in: "Retoma",
  order: "Encomenda",
  reservation: "Reserva",
  offer: "Proposta",
  alert: "Alerta de stock",
};

// Pipeline de estados (ordem visual do funil).
const STATUSES: LeadStatus[] = ["new", "contacted", "proposal", "won", "lost"];
const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "Novas",
  contacted: "Em contacto",
  proposal: "Proposta",
  won: "Ganhas",
  lost: "Perdidas",
  closed: "Fechadas",
};

export function LeadsTable({ leads }: { leads: Lead[] }) {
  const [filter, setFilter] = useState<LeadStatus | "">("");
  const [kindFilter, setKindFilter] = useState<LeadKind | "">("");
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(
    () =>
      leads.filter(
        (l) =>
          (!filter || l.status === filter) &&
          (!kindFilter || l.kind === kindFilter),
      ),
    [leads, filter, kindFilter],
  );

  // Contagem por tipo (origem do lead) para os chips.
  const kindCounts = useMemo(() => {
    const m = {} as Record<LeadKind, number>;
    for (const l of leads) m[l.kind] = (m[l.kind] ?? 0) + 1;
    return m;
  }, [leads]);

  function exportCsv() {
    const cols = [
      "Data",
      "Tipo",
      "Estado",
      "Nome",
      "Email",
      "Telefone",
      "Viatura",
      "Mensagem",
      "Notas",
    ];
    const esc = csvCell;
    const rows = filtered.map((l) =>
      [
        new Date(l.created_at).toLocaleString("pt-PT"),
        KIND_LABEL[l.kind],
        STATUS_LABEL[l.status],
        l.name,
        l.email,
        l.phone ?? "",
        l.car_label ?? "",
        (l.message ?? "").replace(/\n/g, " "),
        (l.notes ?? "").replace(/\n/g, " "),
      ]
        .map(esc)
        .join(","),
    );
    // BOM para o Excel abrir os acentos corretamente.
    const csv = "﻿" + [cols.map(esc).join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function change(id: string, status: LeadStatus) {
    startTransition(async () => {
      const res = await setLeadStatus(id, status);
      if (res.ok) toast.success("Estado atualizado.");
      else toast.error("Erro ao atualizar.");
    });
  }
  function remove(id: string) {
    if (!confirm("Apagar este lead?")) return;
    startTransition(async () => {
      const res = await deleteLead(id);
      if (res.ok) toast.success("Lead apagado.");
      else toast.error("Erro ao apagar.");
    });
  }

  if (leads.length === 0) {
    return (
      <div className="card grid place-items-center p-16 text-center">
        <p className="text-4xl">📭</p>
        <p className="mt-3 font-medium text-paper">Ainda não há leads</p>
        <p className="mt-1 text-sm text-paper/50">
          Contactos, test drives, retomas e encomendas aparecem aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Funil de estados */}
      <div className="flex flex-wrap gap-2">
        <FilterChip active={filter === ""} onClick={() => setFilter("")}>
          Todas ({leads.length})
        </FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {STATUS_LABEL[s]} ({leads.filter((l) => l.status === s).length})
          </FilterChip>
        ))}
      </div>

      {/* Filtro por tipo (origem) + exportação */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => setKindFilter("")}
          className={`rounded-full px-3 py-1 ${kindFilter === "" ? "bg-white/15 text-paper" : "text-paper/50 hover:text-paper"}`}
        >
          Todos os tipos
        </button>
        {(Object.keys(KIND_LABEL) as LeadKind[])
          .filter((k) => (kindCounts[k] ?? 0) > 0)
          .map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={`rounded-full px-3 py-1 ${kindFilter === k ? "bg-white/15 text-paper" : "text-paper/50 hover:text-paper"}`}
            >
              {KIND_LABEL[k]} ({kindCounts[k]})
            </button>
          ))}
        <button
          onClick={exportCsv}
          className="ml-auto rounded-full border border-white/15 px-3 py-1 font-medium text-paper/70 transition-colors hover:border-accent hover:text-accent"
        >
          ⤓ Exportar CSV ({filtered.length})
        </button>
      </div>

      <ul className="space-y-3">
        {filtered.map((l) => (
          <LeadCard
            key={l.id}
            lead={l}
            pending={pending}
            onStatus={change}
            onDelete={remove}
          />
        ))}
      </ul>
    </div>
  );
}

function LeadCard({
  lead: l,
  pending,
  onStatus,
  onDelete,
}: {
  lead: Lead;
  pending: boolean;
  onStatus: (id: string, s: LeadStatus) => void;
  onDelete: (id: string) => void;
}) {
  const [notes, setNotes] = useState(l.notes ?? "");
  const [saving, startSave] = useTransition();
  const details = Object.entries(l.car_details ?? {}).filter(
    ([, v]) => v != null && v !== "",
  );

  function save() {
    startSave(async () => {
      const res = await saveLeadNotes(l.id, notes);
      if (res.ok) toast.success("Nota guardada.");
      else toast.error("Erro ao guardar nota.");
    });
  }

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-paper">{l.name}</span>
            <LeadStatusBadge status={l.status} />
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-paper/50">
              {KIND_LABEL[l.kind]}
            </span>
          </div>
          <p className="mt-1 text-sm text-paper/60">
            {l.email ? (<a href={`mailto:${l.email}`} className="hover:text-accent hover:underline">
              {l.email}
            </a>) : null}
            {l.phone && (
              <>
                {l.email ? " · " : null}
                <a href={`tel:${l.phone}`} className="hover:text-accent hover:underline">
                  {l.phone}
                </a>
              </>
            )}
          </p>
          {l.car_label && (
            <p className="mt-1 text-xs text-paper/50">
              {l.car_label}
              {l.preferred_date && ` · Data: ${l.preferred_date}`}
            </p>
          )}
          {details.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {details.map(([k, v]) => (
                <li
                  key={k}
                  className="rounded-md bg-white/5 px-2 py-1 text-xs text-paper/70"
                >
                  <span className="capitalize text-paper/40">{k}:</span>{" "}
                  {String(v)}
                </li>
              ))}
            </ul>
          )}
          {l.message && (
            <p className="mt-2 max-w-2xl rounded-lg bg-white/5 p-3 text-sm text-paper/70">
              {l.message}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            value={l.status}
            disabled={pending}
            onChange={(e) => onStatus(l.id, e.target.value as LeadStatus)}
            className="rounded-lg border border-white/10 bg-ink px-2 py-1.5 text-xs text-paper"
            aria-label="Estado do lead"
          >
            {(["new", "contacted", "proposal", "won", "lost", "closed"] as LeadStatus[]).map(
              (s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ),
            )}
          </select>
          <button
            type="button"
            disabled={pending}
            onClick={() => onDelete(l.id)}
            className="rounded-lg px-2 py-1.5 text-xs text-red-400/70 hover:bg-red-500/10 hover:text-red-300"
            title="Apagar"
          >
            🗑
          </button>
        </div>
      </div>

      {/* Notas internas (CRM) */}
      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={1}
          placeholder="Notas internas…"
          className="field min-h-[38px] flex-1 text-sm"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || notes === (l.notes ?? "")}
          className="btn-ghost h-[38px] px-4 py-0 disabled:opacity-40"
        >
          {saving ? "…" : "Guardar"}
        </button>
      </div>

      <p className="mt-2 text-[11px] text-paper/30">
        {new Date(l.created_at).toLocaleString("pt-PT")}
      </p>
    </li>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
        active
          ? "bg-accent font-medium text-ink"
          : "border border-white/15 text-paper/70 hover:border-white/40"
      }`}
    >
      {children}
    </button>
  );
}
