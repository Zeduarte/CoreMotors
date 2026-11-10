import Link from "next/link";
import { requireSection } from "@/lib/guard";
import { getProfiles } from "@/lib/admin-queries";
import { getHours } from "@/lib/hours-queries";
import { monthRange, summarizeHours } from "@/lib/hours";
import { canAccess } from "@/lib/permissions";
import { HoursForm, HoursList } from "@/components/admin/HoursManager";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ mes?: string; pessoa?: string }>;

const h = (n: number) => `${n.toLocaleString("pt-PT")} h`;

/**
 * Horas de trabalho. Cada um vê as suas: as feitas nas viaturas (Oficina ou
 * WhatsApp) aparecem sozinhas, e aqui regista-se o resto. O administrador vê
 * as de toda a gente, com totais por pessoa.
 */
export default async function HorasPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireSection("horas");
  const params = await searchParams;
  const isAdmin = me.role === "admin";

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
  const range = monthRange(params.mes, today);

  // O administrador começa por ver toda a gente; os outros, sempre só as suas.
  const pessoa = isAdmin ? (params.pessoa ?? "todos") : me.id;
  const personId = pessoa === "todos" ? null : pessoa;

  const [{ entries, missingTable }, profiles] = await Promise.all([
    getHours(range.from, range.to, personId),
    isAdmin ? getProfiles() : Promise.resolve([]),
  ]);
  const summary = summarizeHours(entries);
  const names: Record<string, string> = Object.fromEntries(
    profiles.map((p) => [p.id, p.full_name || p.email || "—"]),
  );

  const monthLabel = new Date(`${range.from}T12:00:00`).toLocaleDateString("pt-PT", {
    month: "long",
    year: "numeric",
  });
  const link = (mes: string) =>
    `/admin/horas?mes=${mes}${isAdmin ? `&pessoa=${encodeURIComponent(pessoa)}` : ""}`;

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-paper">Horas</h1>
          <p className="mt-1 text-sm text-paper/50">
            {isAdmin
              ? "Horas de trabalho da equipa: as feitas nas viaturas e as outras tarefas."
              : "As suas horas de trabalho: as feitas nas viaturas aparecem sozinhas; registe aqui as outras tarefas."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={link(range.prev)} className="btn-ghost px-3" aria-label="Mês anterior">‹</Link>
          <span className="min-w-36 text-center text-sm font-medium capitalize text-paper">{monthLabel}</span>
          <Link href={link(range.next)} className="btn-ghost px-3" aria-label="Mês seguinte">›</Link>
        </div>
      </div>

      {missingTable && (
        <p role="alert" className="card mb-6 p-4 text-sm text-amber-300">
          Falta aplicar a migração <code>0029_time_entries.sql</code> no Supabase. Até lá só aparecem as horas das viaturas.
        </p>
      )}

      {isAdmin && (
        <form className="mb-6 flex flex-wrap items-center gap-2" action="/admin/horas">
          <input type="hidden" name="mes" value={range.month} />
          <label className="text-sm text-paper/60" htmlFor="pessoa">Pessoa</label>
          <select id="pessoa" name="pessoa" defaultValue={pessoa} className="field h-10 !w-auto">
            <option value="todos">Toda a equipa</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === me.id ? `${names[p.id]} (você)` : names[p.id]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-ghost">Ver</button>
        </form>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Total do mês", h(summary.total)],
          ["Em viaturas", h(summary.vehicle)],
          ["Outras tarefas", h(summary.other)],
          ["Em curso", String(summary.open)],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-xs uppercase tracking-wider text-paper/50">{label}</p>
            <p className="mt-1 text-xl font-semibold text-paper">{value}</p>
          </div>
        ))}
      </div>

      {isAdmin && personId === null && summary.byPerson.length > 0 && (
        <div className="card mb-6 overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-paper/50">
              <tr>
                <th className="p-3">Pessoa</th>
                <th className="p-3 text-right">Viaturas</th>
                <th className="p-3 text-right">Outras</th>
                <th className="p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {summary.byPerson.map((p) => (
                <tr key={p.personId ?? "sem"} className="border-t border-white/10">
                  <td className="p-3">
                    {p.personId ? (
                      <Link href={`/admin/horas?mes=${range.month}&pessoa=${p.personId}`} className="text-paper hover:text-accent">
                        {names[p.personId] ?? "—"}
                      </Link>
                    ) : (
                      <span className="text-paper/50">Utilizador apagado</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-paper/70">{h(p.vehicle)}</td>
                  <td className="p-3 text-right text-paper/70">{h(p.other)}</td>
                  <td className="p-3 text-right font-semibold text-paper">{h(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start">
        {(personId === null || personId === me.id) ? <HoursForm /> : <div className="hidden lg:block" />}
        <HoursList
          entries={entries}
          people={personId === null ? names : undefined}
          canOpenWorkshop={canAccess(me.role, me.allowed_sections, "oficina")}
          currentUserId={me.id}
          isAdmin={isAdmin}
        />
      </div>
    </>
  );
}
