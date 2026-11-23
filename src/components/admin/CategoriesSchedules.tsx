"use client";

import { useState } from "react";
import {
  createSchedule,
  deleteCategory,
  deleteSchedule,
  saveCategory,
  setScheduleEnabled,
} from "@/lib/actions/fb-discovery";
import { describeSchedule, JOIN_DAILY_LIMIT, WEEKDAY_SHORT } from "@/lib/fb-discovery";
import { SHARE_DAILY_LIMIT, normalizeName } from "@/lib/fb-shares";
import type { FbAccountRow, FbCategoryRow, FbScheduleKind, FbScheduleRow, FbShareAdRow } from "@/lib/supabase/database.types";

type Act = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string, after?: () => void) => void;

const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon" });

/**
 * Separador «Categorias e horários»: as categorias de palavras-chave (para
 * procurar grupos novos e para escolher onde partilhar) e os horários
 * automáticos desta conta do Facebook.
 */
export function CategoriesSchedules({
  account,
  categories,
  schedules,
  ads,
  busy,
  extensionReady,
  act,
}: {
  account: FbAccountRow;
  categories: FbCategoryRow[];
  schedules: FbScheduleRow[];
  ads: FbShareAdRow[];
  busy: boolean;
  extensionReady: boolean;
  act: Act;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <CategoriesCard categories={categories} busy={busy} act={act} />
      <SchedulesCard
        account={account}
        categories={categories}
        schedules={schedules}
        ads={ads}
        busy={busy}
        extensionReady={extensionReady}
        act={act}
      />
    </div>
  );
}

/** Sugestões para começar (só aparecem as que ainda não existem). */
const CATEGORY_TEMPLATES: { name: string; keywords: string }[] = [
  { name: "Automóveis", keywords: "carros, automóveis, veículos, viaturas, carrinhas, compra e venda carros" },
  { name: "Motas", keywords: "motas, motos, moto4, motorizadas, scooters, quads, motociclos" },
  { name: "Peças", keywords: "peças auto, peças motas, desmanche, acessórios auto" },
  { name: "Vendas em geral", keywords: "compra e venda, vendas, marketplace, usados, classificados" },
];

function CategoriesCard({ categories, busy, act }: { categories: FbCategoryRow[]; busy: boolean; act: Act }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(categories.length === 0);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const reset = () => {
    setEditing(null);
    setName("");
    setKeywords("");
    setOpen(false);
  };
  const taken = new Set(categories.map((c) => normalizeName(c.name)));
  const templates = CATEGORY_TEMPLATES.filter((t) => !taken.has(normalizeName(t.name)));

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-paper">Categorias</h2>
          <p className="text-sm text-paper/50">
            Cada categoria tem as palavras-chave a procurar no Facebook, e serve também para filtrar os seus grupos e partilhar
            só nos de uma categoria. São do seu perfil CoreMotors: valem para todas as suas contas do Facebook.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            className="btn-primary h-10 shrink-0 px-4"
            disabled={busy}
            onClick={() => {
              setEditing(null);
              setName("");
              setKeywords("");
              setOpen(true);
            }}
          >
            + Nova categoria
          </button>
        )}
      </div>

      {categories.length > 0 && (
        <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
          {categories.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="font-medium text-paper">{c.name}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.keywords.map((k) => (
                    <span key={k} className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-paper/70">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button
                  type="button"
                  className="text-paper/60 underline hover:text-paper"
                  disabled={busy}
                  onClick={() => {
                    setEditing(c.id);
                    setName(c.name);
                    setKeywords(c.keywords.join(", "));
                    setOpen(true);
                  }}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="text-red-300/80 underline hover:text-red-300"
                  disabled={busy}
                  onClick={() =>
                    window.confirm(`Apagar a categoria «${c.name}»? Os horários dela também são apagados.`) &&
                    act(() => deleteCategory(c.id), "Categoria apagada.", () => editing === c.id && reset())
                  }
                >
                  Apagar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
      <form
        className="space-y-3 border-t border-white/10 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          act(() => saveCategory({ id: editing, name, keywords }), editing ? "Categoria alterada." : "Categoria criada.", reset);
        }}
      >
        <p className="text-sm font-medium text-paper">{editing ? "Editar categoria" : "Nova categoria"}</p>
        {!editing && templates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-paper/40">Sugestões:</span>
            {templates.map((t) => (
              <button
                key={t.name}
                type="button"
                className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-paper/70 hover:border-white/40"
                onClick={() => {
                  setName(t.name);
                  setKeywords(t.keywords);
                }}
              >
                + {t.name}
              </button>
            ))}
          </div>
        )}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome, ex.: Carros"
          maxLength={60}
          className="field"
          aria-label="Nome da categoria"
        />
        <textarea
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          rows={3}
          placeholder="Palavras-chave separadas por vírgulas, ex.: carros, automóveis, viaturas, compra e venda carros"
          className="field"
          aria-label="Palavras-chave"
        />
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={busy || !name.trim() || !keywords.trim()}>
            {editing ? "Gravar" : "Criar categoria"}
          </button>
          {(editing || categories.length > 0) && (
            <button type="button" className="btn-ghost" onClick={reset}>
              Cancelar
            </button>
          )}
        </div>
      </form>
      )}
    </div>
  );
}

function SchedulesCard({
  account,
  categories,
  schedules,
  ads,
  busy,
  extensionReady,
  act,
}: {
  account: FbAccountRow;
  categories: FbCategoryRow[];
  schedules: FbScheduleRow[];
  ads: FbShareAdRow[];
  busy: boolean;
  extensionReady: boolean;
  act: Act;
}) {
  const activeAds = ads.filter((a) => !a.archived);
  const [kind, setKind] = useState<FbScheduleKind>("join");
  const [categoryId, setCategoryId] = useState("");
  const [adId, setAdId] = useState(activeAds[0]?.id ?? "");
  const [count, setCount] = useState(3);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [atTime, setAtTime] = useState("18:00");
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const adTitle = new Map(ads.map((a) => [a.id, a.title]));
  const maxCount = kind === "join" ? JOIN_DAILY_LIMIT : SHARE_DAILY_LIMIT;
  const effectiveCategory = categoryId || (kind === "join" ? (categories[0]?.id ?? "") : "");

  const label = (s: FbScheduleRow) => {
    const cat = s.category_id ? `«${categoryName.get(s.category_id) ?? "?"}»` : "da fila";
    return s.kind === "join"
      ? `Aderir a ${s.count} grupo${s.count === 1 ? "" : "s"} de ${cat}`
      : `Partilhar «${(s.ad_id && adTitle.get(s.ad_id)) || "?"}» em ${s.count} grupo${s.count === 1 ? "" : "s"} ${s.category_id ? `de ${cat}` : "da fila"}`;
  };

  return (
    <div className="card space-y-4 p-5">
      <div>
        <h2 className="text-lg font-semibold text-paper">Horários automáticos de {account.name}</h2>
        <p className="text-sm text-paper/50">
          À hora marcada (hora de Portugal) a extensão abre esta página e faz o trabalho sozinha. O Chrome tem de estar aberto,
          com sessão no backoffice e no Facebook desta conta; se estiver fechado, corre quando abrir, até 2 horas depois.
        </p>
        {!extensionReady && schedules.length > 0 && (
          <p className="mt-2 text-sm text-amber-300">Ligue a extensão neste Chrome para os horários correrem.</p>
        )}
      </div>

      {schedules.length > 0 && (
        <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
          {schedules.map((s) => (
            <li key={s.id} className={`flex items-start justify-between gap-3 p-3 ${s.enabled ? "" : "opacity-50"}`}>
              <div className="min-w-0 text-sm">
                <p className="font-medium text-paper">{label(s)}</p>
                <p className="text-xs text-paper/50">
                  {describeSchedule(s.weekdays, s.at_time)}
                  {s.last_run_at ? ` · última vez ${when(s.last_run_at)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button
                  type="button"
                  className="text-paper/60 underline hover:text-paper"
                  disabled={busy}
                  onClick={() => act(() => setScheduleEnabled(s.id, !s.enabled), s.enabled ? "Horário pausado." : "Horário ligado.")}
                >
                  {s.enabled ? "Pausar" : "Ligar"}
                </button>
                <button
                  type="button"
                  className="text-red-300/80 underline hover:text-red-300"
                  disabled={busy}
                  onClick={() => window.confirm("Apagar este horário?") && act(() => deleteSchedule(s.id), "Horário apagado.")}
                >
                  Apagar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="space-y-3 border-t border-white/10 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () =>
              createSchedule({
                accountId: account.id,
                kind,
                categoryId: effectiveCategory || null,
                adId: kind === "share" ? adId || null : null,
                count: Math.min(count, maxCount),
                weekdays,
                atTime,
              }),
            "Horário criado.",
          );
        }}
      >
        <p className="text-sm font-medium text-paper">Novo horário</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de horário">
          {(
            [
              ["join", "Aderir a grupos novos"],
              ["share", "Partilhar um anúncio"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
                setCategoryId("");
                setCount((c) => Math.min(c, k === "join" ? JOIN_DAILY_LIMIT : SHARE_DAILY_LIMIT));
              }}
              className={`rounded-full px-3 py-1.5 text-xs ${kind === k ? "bg-accent text-ink" : "bg-white/10 text-paper/70 hover:bg-white/15"}`}
            >
              {l}
            </button>
          ))}
        </div>

        {kind === "share" && (
          <label className="block text-sm text-paper/70">
            Anúncio
            <select className="field mt-1" value={adId} onChange={(e) => setAdId(e.target.value)}>
              {activeAds.length === 0 && <option value="">Crie primeiro um anúncio no separador Partilhar</option>}
              {activeAds.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-sm text-paper/70">
          {kind === "join" ? "Categoria a procurar" : "Em que grupos"}
          <select className="field mt-1" value={effectiveCategory} onChange={(e) => setCategoryId(e.target.value)}>
            {kind === "share" && <option value="">Todos os grupos da fila do anúncio</option>}
            {kind === "join" && categories.length === 0 && <option value="">Crie primeiro uma categoria</option>}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {kind === "share" ? `Só os de «${c.name}»` : c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-3 text-sm text-paper/70">
          {kind === "join" ? "Aderir a" : "Partilhar em"}
          <input
            type="number"
            min={1}
            max={maxCount}
            value={count}
            onChange={(e) => setCount(Math.min(maxCount, Math.max(1, Number(e.target.value) || 1)))}
            className="field h-10 !w-20"
          />
          grupos
<span className="text-xs text-paper/40">(máx. {maxCount} por dia)</span>
        </label>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias da semana">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const on = weekdays.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => setWeekdays((w) => (on ? w.filter((x) => x !== d) : [...w, d]))}
                className={`h-9 w-11 rounded-lg text-xs ${on ? "bg-accent text-ink" : "bg-white/10 text-paper/70 hover:bg-white/15"}`}
              >
                {WEEKDAY_SHORT[d]}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-3 text-sm text-paper/70">
          Às
          <input type="time" value={atTime} onChange={(e) => setAtTime(e.target.value)} className="field h-10 !w-32" required />
        </label>

        <button
          type="submit"
          className="btn-primary"
          disabled={busy || !weekdays.length || (kind === "join" ? !effectiveCategory : !adId)}
        >
          Criar horário
        </button>
      </form>
    </div>
  );
}
