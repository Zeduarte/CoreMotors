"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  COMPANY_DAY_LABEL,
  companyCalendar,
  isSelectable,
  isoDay,
  summarise,
  type CompanyDay,
  type LeaveBalance,
  type LeaveDay,
} from "@/lib/leave";
import { applyLeaveChanges } from "@/lib/actions/leave";

/**
 * Calendário anual de férias.
 *
 * Em leitura mostra o plano. Em "Registar férias" entra-se num rascunho: os
 * dias que se juntam ficam verdes, os que se retiram ficam vermelhos, e nada
 * é gravado até "Guardar alterações" — assim vê-se o antes e o depois antes
 * de decidir.
 */

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function LeaveCalendar({
  year,
  years,
  balance,
  days,
  extras,
  readOnly = false,
  selfApproves = false,
}: {
  year: number;
  years: number[];
  balance: LeaveBalance;
  days: LeaveDay[];
  extras: CompanyDay[];
  readOnly?: boolean;
  /** Quem aprova o próprio plano (o administrador) pode retirar dias aprovados. */
  selfApproves?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Rascunho local: dias a juntar e dias a retirar, ainda por gravar.
  const [editing, setEditing] = useState(false);
  const [toAdd, setToAdd] = useState<Map<string, boolean>>(new Map());
  const [toRemove, setToRemove] = useState<Set<string>>(new Set());

  const calendar = useMemo(() => companyCalendar(year, extras), [year, extras]);
  const marcados = useMemo(
    () => new Map(days.map((d) => [d.day, d])),
    [days],
  );
  // O resumo acompanha o rascunho: o saldo muda à medida que se edita.
  const previstos = useMemo(() => {
    const base = days.filter(
      (d) => !toRemove.has(d.day) && !toAdd.has(d.day),
    );
    // O que se junta conta já no estado com que vai ficar — um dia recusado
    // que se volta a pedir passa a contar no saldo.
    const juntos = [...toAdd.entries()].map(([day, half]): LeaveDay => ({
      day,
      half,
      status: selfApproves ? "approved" : "pending",
    }));
    return [...base, ...juntos];
  }, [days, toAdd, toRemove, selfApproves]);

  const resumo = summarise(balance, editing ? previstos : days);
  const alteracoes = toAdd.size + toRemove.size;

  function clicar(day: string) {
    if (readOnly || !editing || pending) return;
    const marcado = marcados.get(day);

    // Um dia aprovado é um compromisso com a equipa: só sai por quem o aprovou.
    if (marcado?.status === "approved" && !selfApproves) {
      toast.info("Este dia já está aprovado. Para o cancelar, fale com quem o aprovou.");
      return;
    }

    // Um dia já marcado: primeiro clique risca-o (vermelho), segundo repõe.
    // O recusado não conta — clicar nele volta a pedi-lo, como num dia livre.
    if (marcado && marcado.status !== "rejected" && !toAdd.has(day)) {
      setToRemove((prev) => {
        const next = new Set(prev);
        if (next.has(day)) next.delete(day);
        else next.add(day);
        return next;
      });
      return;
    }

    // Um dia livre: inteiro → meio dia → livre outra vez.
    setToAdd((prev) => {
      const next = new Map(prev);
      const atual = next.get(day);
      if (atual === undefined) next.set(day, false);
      else if (atual === false) next.set(day, true);
      else next.delete(day);
      return next;
    });
  }

  function guardar() {
    start(async () => {
      const res = await applyLeaveChanges({
        year,
        add: [...toAdd.entries()].map(([day, half]) => ({ day, half })),
        remove: [...toRemove],
      });
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível guardar as alterações.");
        return;
      }
      toast.success(
        toAdd.size === 0
          ? "Dias retirados."
          : res.approved
            ? "Férias registadas e aprovadas."
            : "Alterações enviadas para aprovação.",
      );
      setToAdd(new Map());
      setToRemove(new Set());
      setEditing(false);
      router.refresh();
    });
  }

  function cancelar() {
    setToAdd(new Map());
    setToRemove(new Set());
    setEditing(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-paper/60">
          Ano{" "}
          <select
            className="field ml-2 inline-block w-auto py-1.5"
            value={year}
            onChange={(e) => router.push(`?ano=${e.target.value}`)}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {!readOnly && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn-primary h-auto px-5 py-2 text-sm"
          >
            Registar férias
          </button>
        )}
        {editing && (
          <>
            <button
              type="button"
              onClick={guardar}
              disabled={pending || alteracoes === 0}
              className="btn-primary h-auto px-5 py-2 text-sm"
            >
              {pending
                ? "A guardar…"
                : `Guardar ${alteracoes} ${alteracoes === 1 ? "alteração" : "alterações"}`}
            </button>
            <button
              type="button"
              onClick={cancelar}
              disabled={pending}
              className="btn-ghost h-auto px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <p className="text-xs text-paper/50">
              Clique num dia livre (ou recusado) para o pedir, ou num dia por
              aprovar para o retirar.
            </p>
          </>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_280px]">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {MESES.map((nome, mes) => (
            <Month
              key={nome}
              year={year}
              month={mes}
              label={nome}
              calendar={calendar}
              marcados={marcados}
              toAdd={toAdd}
              toRemove={toRemove}
              onPick={clicar}
              editing={editing && !readOnly}
            />
          ))}
        </div>

        <aside className="space-y-3">
          <Card titulo="Total de dias" valor={resumo.total} destaque />
          <div className="card overflow-hidden p-0 text-sm">
            <Row label="Férias normais" value={balance.baseDays} />
            <Row label="Férias ano anterior" value={balance.carriedDays} />
            <Row label="Dia de aniversário" value={balance.birthdayDay} />
          </div>
          <Card titulo="Dias marcados" valor={resumo.marked} />
          <Card titulo="Saldo disponível" valor={resumo.available} />
          {resumo.pending > 0 && (
            <p className="px-1 text-xs text-paper/50">
              {fmt(resumo.pending)} à espera de aprovação.
            </p>
          )}
        </aside>
      </div>

      <Legend editing={editing} />
    </div>
  );
}

function Month({
  year,
  month,
  label,
  calendar,
  marcados,
  toAdd,
  toRemove,
  onPick,
  editing,
}: {
  year: number;
  month: number;
  label: string;
  calendar: Map<string, CompanyDay>;
  marcados: Map<string, LeaveDay>;
  toAdd: Map<string, boolean>;
  toRemove: Set<string>;
  onPick: (day: string) => void;
  editing: boolean;
}) {
  const primeiro = new Date(year, month, 1);
  const dias = new Date(year, month + 1, 0).getDate();
  // Espaços antes do dia 1 para a coluna certa da semana.
  const vazios = Array.from({ length: primeiro.getDay() });

  return (
    <section className="card p-3">
      <h3 className="mb-2 text-center text-sm font-medium text-paper">
        {label} {year}
      </h3>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-paper/40">
        {SEMANA.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-0.5">
        {vazios.map((_, i) => (
          <span key={`v${i}`} />
        ))}
        {Array.from({ length: dias }, (_, i) => {
          const day = isoDay(new Date(year, month, i + 1));
          return (
            <Day
              key={day}
              day={day}
              numero={i + 1}
              especial={calendar.get(day)}
              marcado={marcados.get(day)}
              livre={isSelectable(day, calendar)}
              aJuntar={toAdd.get(day)}
              aRetirar={toRemove.has(day)}
              onPick={onPick}
              editing={editing}
            />
          );
        })}
      </div>
    </section>
  );
}

function Day({
  day,
  numero,
  especial,
  marcado,
  livre,
  aJuntar,
  aRetirar,
  onPick,
  editing,
}: {
  day: string;
  numero: number;
  especial?: CompanyDay;
  marcado?: LeaveDay;
  livre: boolean;
  /** No rascunho: `false` dia inteiro, `true` meio dia, ausente não se junta. */
  aJuntar?: boolean;
  aRetirar: boolean;
  onPick: (day: string) => void;
  editing: boolean;
}) {
  // A ordem importa: o rascunho fala mais alto do que o que está gravado,
  // porque é o que o utilizador acabou de decidir.
  const estilo = aRetirar
    ? "bg-red-500/80 font-semibold text-white line-through"
    : aJuntar !== undefined
      ? "bg-emerald-500/80 font-semibold text-ink"
      : especial
        ? ESPECIAL[especial.kind]
        : marcado
          ? MARCADO[marcado.status]
          : livre
            ? editing
              ? "text-paper/80 hover:bg-white/10"
              : "text-paper/60"
            : "text-paper/25";

  const titulo = [
    aRetirar ? "A retirar" : null,
    aJuntar !== undefined ? (aJuntar ? "A juntar (meio dia)" : "A juntar") : null,
    especial
      ? `${COMPANY_DAY_LABEL[especial.kind]}${especial.label ? `: ${especial.label}` : ""}`
      : null,
    marcado ? `${marcado.half ? "Meio dia" : "Dia inteiro"} · ${ESTADO[marcado.status]}` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  const meio = aJuntar !== undefined ? aJuntar : marcado?.half;
  const conteudo = meio && !aRetirar ? "½" : numero;
  const clicavel = editing && livre;

  return (
    <button
      type="button"
      disabled={!clicavel}
      onClick={() => onPick(day)}
      title={titulo || undefined}
      aria-label={`${numero}${titulo ? ` — ${titulo}` : ""}`}
      className={`grid aspect-square place-items-center rounded text-xs transition-colors ${estilo} ${
        clicavel ? "cursor-pointer" : "cursor-default"
      }`}
    >
      {conteudo}
    </button>
  );
}

const ESPECIAL: Record<CompanyDay["kind"], string> = {
  holiday: "bg-amber-700/80 font-semibold text-white",
  tolerance: "bg-sky-400/80 font-semibold text-ink",
  mandatory: "bg-teal-700/80 font-semibold text-white",
};

const MARCADO: Record<LeaveDay["status"], string> = {
  draft: "bg-white/15 font-semibold text-paper ring-1 ring-dashed ring-white/40",
  pending: "bg-white/25 font-semibold text-paper",
  approved: "bg-slate-600 font-semibold text-white",
  rejected: "text-red-300/70 line-through",
};

const ESTADO: Record<LeaveDay["status"], string> = {
  draft: "por submeter",
  pending: "à espera de aprovação",
  approved: "aprovado",
  rejected: "recusado",
};

function Legend({ editing }: { editing: boolean }) {
  const base: [string, string][] = [
    ["bg-amber-700/80", "Feriado"],
    ["bg-sky-400/80", "Tolerância"],
    ["bg-teal-700/80", "Dia obrigatório"],
    ["bg-white/25", "À espera de aprovação"],
    ["bg-slate-600", "Plano aprovado"],
  ];
  const rascunho: [string, string][] = [
    ["bg-emerald-500/80", "A juntar"],
    ["bg-red-500/80", "A retirar"],
  ];
  const itens = editing ? [...rascunho, ...base] : base;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-paper/60">
      {itens.map(([cor, label]) => (
        <span key={label} className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-sm ${cor}`} aria-hidden />
          {label}
        </span>
      ))}
      <span className="flex items-center gap-2">
        <span className="font-semibold text-paper">½</span> Meio dia
      </span>
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString("pt-PT", { minimumFractionDigits: 1 });

function Card({
  titulo,
  valor,
  destaque = false,
}: {
  titulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div className="card flex items-center justify-between gap-3 p-4">
      <p className="text-sm text-paper/60">{titulo}</p>
      <p
        className={`font-semibold ${destaque ? "text-2xl text-accent" : "text-xl text-paper"}`}
      >
        {fmt(valor)}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2.5 last:border-0">
      <span className="text-paper/60">{label}</span>
      <span className="font-medium text-paper">{fmt(value)}</span>
    </div>
  );
}
