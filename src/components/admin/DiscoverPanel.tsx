"use client";

import { useState } from "react";
import { JOIN_DAILY_LIMIT, JOIN_STATUS_LABEL, type FoundGroup } from "@/lib/fb-discovery";
import type { FbCategoryRow, FbGroupJoinRow, FbGroupRow, FbJoinStatus } from "@/lib/supabase/database.types";

const JOIN_STYLE: Record<FbJoinStatus | "accepted", string> = {
  joined: "bg-emerald-500/15 text-emerald-300",
  accepted: "bg-emerald-500/15 text-emerald-300",
  requested: "bg-amber-500/15 text-amber-300",
  questions: "bg-amber-500/15 text-amber-300",
  member: "bg-white/10 text-paper/60",
  limited: "bg-red-500/15 text-red-300",
  failed: "bg-red-500/10 text-red-300/80",
};

export function JoinBadge({ status }: { status: FbJoinStatus | "accepted" }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${JOIN_STYLE[status]}`}>
      {status === "accepted" ? "Aceite" : JOIN_STATUS_LABEL[status]}
    </span>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon" });

export interface FoundRow extends FoundGroup {
  keyword: string;
  /** Pode pedir-se adesão (palavra-chave, ainda não tratado nesta conta…). */
  candidate: boolean;
  /** Porque não é candidato, se não for. */
  why: string;
}

/**
 * Separador «Procurar grupos»: procurar grupos novos no Facebook pelas
 * palavras-chave de uma categoria e pedir adesão, dentro do limite diário.
 * Os cliques são feitos pela extensão; aqui só se escolhe e se vê o resultado.
 */
export function DiscoverPanel({
  categories,
  joins,
  groups,
  remaining,
  busy,
  canUse,
  running,
  status,
  found,
  log,
  onSearch,
  onRun,
  onJoinOne,
  onStop,
  onCheckAccepted,
  onGoToCategories,
}: {
  categories: FbCategoryRow[];
  joins: FbGroupJoinRow[];
  groups: FbGroupRow[];
  remaining: number;
  busy: boolean;
  canUse: boolean;
  running: boolean;
  status: string | null;
  found: FoundRow[];
  log: React.ReactNode;
  onSearch: (categoryId: string) => void;
  onRun: (categoryId: string, count: number, publicOnly: boolean) => void;
  onJoinOne: (row: FoundRow, categoryId: string) => void;
  onStop: () => void;
  onCheckAccepted: () => void;
  onGoToCategories: () => void;
}) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [count, setCount] = useState(Math.max(1, Math.min(JOIN_DAILY_LIMIT, remaining || JOIN_DAILY_LIMIT)));
  const [publicOnly, setPublicOnly] = useState(false);
  const category = categories.find((c) => c.id === categoryId) ?? categories[0] ?? null;
  const memberKeys = new Set(groups.filter((g) => g.position !== null).map((g) => g.group_key.toLowerCase()));
  const used = JOIN_DAILY_LIMIT - remaining;
  const howMany = Math.max(1, Math.min(count, remaining || 1));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  if (!categories.length)
    return (
      <div className="card space-y-3 p-6 text-sm text-paper/70">
        <p>
          Para procurar grupos novos, crie primeiro uma categoria com as palavras-chave a procurar no Facebook (por exemplo
          «Carros»: carros, automóveis, viaturas).
        </p>
        <button type="button" className="btn-primary" onClick={onGoToCategories}>
          Criar uma categoria
        </button>
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="card space-y-4 p-5">
          <h2 className="text-lg font-semibold text-paper">Procurar e aderir</h2>
          <div className="flex items-end gap-2">
            <label className="block min-w-0 flex-1 text-sm text-paper/70">
              Categoria a procurar
              <select className="field mt-1" value={category?.id ?? ""} onChange={(e) => setCategoryId(e.target.value)} disabled={busy}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.keywords.length} palavra{c.keywords.length === 1 ? "" : "s"})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-ghost h-10 shrink-0 px-3"
              title="Nova categoria"
              aria-label="Nova categoria"
              disabled={busy}
              onClick={onGoToCategories}
            >
              +
            </button>
          </div>
          {category && (
            <div className="flex flex-wrap gap-1.5">
              {category.keywords.map((k) => (
                <span key={k} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-paper/70">
                  {k}
                </span>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl border border-white/10 p-3">
              <p className="text-xs uppercase tracking-wider text-paper/50">Hoje (24 h)</p>
              <p className="mt-1 text-xl font-semibold text-paper">
                {used} de {JOIN_DAILY_LIMIT}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 p-3">
              <p className="text-xs uppercase tracking-wider text-paper/50">Ainda pode</p>
              <p className={`mt-1 text-xl font-semibold ${remaining ? "text-paper" : "text-red-300"}`}>{remaining}</p>
            </div>
          </div>
          <label className="flex items-center gap-3 text-sm text-paper/70">
            Aderir a
            <input
              type="number"
              min={1}
              max={JOIN_DAILY_LIMIT}
              value={count}
              disabled={busy}
              onChange={(e) => setCount(Math.min(JOIN_DAILY_LIMIT, Math.max(1, Number(e.target.value) || 1)))}
              className="field h-10 !w-20"
            />
            grupos agora
          </label>
          <label className="flex items-center gap-2 text-sm text-paper/70">
            <input type="checkbox" checked={publicOnly} disabled={busy} onChange={(e) => setPublicOnly(e.target.checked)} />
            Só grupos públicos (entram logo; os privados ficam à espera dos administradores)
          </label>
          <div className="flex flex-wrap gap-2">
            {running ? (
              <button type="button" className="btn-ghost" onClick={onStop}>
                Parar depois deste grupo
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!category || !canUse || busy || remaining === 0}
                  onClick={() => category && onRun(category.id, howMany, publicOnly)}
                >
                  Procurar e aderir ({howMany})
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!category || !canUse || busy}
                  onClick={() => category && onSearch(category.id)}
                >
                  Só pesquisar
                </button>
              </>
            )}
          </div>
          {status && (
            <p className="text-sm text-paper/70" aria-live="polite">
              {status}
            </p>
          )}
          <p className="text-xs text-paper/40">
            No máximo {JOIN_DAILY_LIMIT} adesões por dia em cada conta, espaçadas por alguns minutos. A Meta não publica um limite,
            mas há muitos relatos de bloqueios de uma semana a partir de cerca de 10 grupos por dia; fica uma margem de 5. Os
            grupos com perguntas ficam marcados para responder no Facebook: a extensão não responde nem aceita regras por si.
          </p>
          {log}
        </div>

        <div className="card p-0">
          <div className="p-5">
            <h2 className="text-lg font-semibold text-paper">Resultados da pesquisa</h2>
            <p className="text-sm text-paper/50">
              Os grupos que o Facebook mostrou para as palavras-chave. Pode pedir adesão a um de cada vez, ou deixar a extensão
              escolher com «Procurar e aderir».
            </p>
          </div>
          {found.length === 0 ? (
            <p className="border-t border-white/10 p-5 text-sm text-paper/50">Ainda não pesquisou nesta sessão.</p>
          ) : (
            <ul className="max-h-[32rem] divide-y divide-white/10 overflow-y-auto border-t border-white/10">
              {found.map((g) => (
                <li key={g.key} className="flex items-start justify-between gap-3 p-4 text-sm">
                  <div className="min-w-0">
                    <a href={g.url} target="_blank" rel="noreferrer" className="text-paper hover:text-accent">
                      {g.name}
                    </a>
                    <p className="text-xs text-paper/40">
                      {g.privacy === "public" ? "Público" : g.privacy === "private" ? "Privado" : "—"} · {g.info} · «{g.keyword}»
                    </p>
                    {!g.candidate && <p className="text-xs text-paper/40">{g.why}</p>}
                  </div>
                  {g.candidate && !memberKeys.has(g.key.toLowerCase()) ? (
                    <button
                      type="button"
                      className="btn-ghost h-8 shrink-0 px-3 text-xs"
                      disabled={!canUse || busy || remaining === 0 || !category}
                      onClick={() => category && onJoinOne(g, category.id)}
                    >
                      Aderir
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="text-lg font-semibold text-paper">Pedidos de adesão</h2>
            <p className="text-sm text-paper/50">
              Os grupos privados só aceitam depois de os administradores aprovarem. «Verificar aceites» lê os seus grupos no
              Facebook: os pedidos aprovados passam a «Aceite» e entram na lista para partilhar.
            </p>
          </div>
          <button type="button" className="btn-ghost" disabled={!canUse || busy} onClick={onCheckAccepted}>
            Verificar aceites
          </button>
        </div>
        {joins.length === 0 ? (
          <p className="border-t border-white/10 p-5 text-sm text-paper/50">Ainda não pediu adesão a nenhum grupo com esta conta.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-paper/50">
                <tr>
                  <th className="p-3">Quando</th>
                  <th className="p-3">Grupo</th>
                  <th className="p-3">Categoria</th>
                  <th className="p-3">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {joins.slice(0, 200).map((j) => {
                  const accepted = (j.status === "requested" || j.status === "questions") && memberKeys.has(j.group_key.toLowerCase());
                  return (
                    <tr key={j.id} className="border-t border-white/10">
                      <td className="whitespace-nowrap p-3 text-paper/50">{when(j.created_at)}</td>
                      <td className="max-w-[22rem] p-3">
                        {j.url ? (
                          <a href={j.url} target="_blank" rel="noreferrer" className="text-paper hover:text-accent">
                            {j.name}
                          </a>
                        ) : (
                          <span className="text-paper">{j.name}</span>
                        )}
                        <span className="block text-xs text-paper/40">
                          {j.privacy === "public" ? "Público" : j.privacy === "private" ? "Privado" : ""}
                          {j.keyword ? ` · «${j.keyword}»` : ""}
                        </span>
                      </td>
                      <td className="p-3 text-paper/60">{(j.category_id && categoryName.get(j.category_id)) || "—"}</td>
                      <td className="p-3">
                        <span className="flex flex-col gap-1">
                          <JoinBadge status={accepted ? "accepted" : j.status} />
                          {j.reason && !accepted && <span className="text-xs text-paper/40">{j.reason}</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
