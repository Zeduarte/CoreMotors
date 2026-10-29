import Link from "next/link";
import { ActionForm } from "@/components/admin/ActionForm";
import { saveBalance } from "@/lib/actions/leave";
import type { ColleagueBalance } from "@/lib/leave-queries";

/**
 * Saldos de férias de quem está abaixo: dias do ano, dias transitados do ano
 * anterior e dia de aniversário. Sem linha gravada valem 22 + 0 + 1.
 */
export function LeaveBalances({
  year,
  years,
  people,
}: {
  year: number;
  years: number[];
  people: ColleagueBalance[];
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-paper">Saldos de férias</h2>
          <p className="text-sm text-paper/50">
            Ajuste os dias de quem está abaixo de si. Aceita meios dias.
          </p>
        </div>
        <nav aria-label="Ano dos saldos" className="flex gap-1">
          {years.map((y) => (
            <Link
              key={y}
              href={`?ano=${y}`}
              aria-current={y === year ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-sm ${
                y === year ? "bg-accent/15 font-medium text-accent" : "text-paper/60 hover:text-paper"
              }`}
            >
              {y}
            </Link>
          ))}
        </nav>
      </div>

      {people.length === 0 ? (
        <p className="card p-5 text-sm text-paper/60">
          Não há colaboradores cujo saldo possa ajustar.
        </p>
      ) : (
        <ul className="space-y-3">
          {people.map((p) => {
            const total = p.balance.baseDays + p.balance.carriedDays + p.balance.birthdayDay;
            return (
              <li key={p.id}>
                <ActionForm
                  action={saveBalance}
                  label="Guardar saldo"
                  success="Saldo guardado."
                  className="card flex flex-wrap items-end gap-3 p-4 [&>fieldset]:flex [&>fieldset]:flex-1 [&>fieldset]:flex-wrap [&>fieldset]:items-end [&>fieldset]:gap-3 [&>fieldset]:space-y-0"
                >
                  <input type="hidden" name="profile_id" value={p.id} />
                  <input type="hidden" name="year" value={year} />
                  <div className="min-w-40 flex-1">
                    <p className="font-medium text-paper">{p.name}</p>
                    <p className="text-xs text-paper/50">
                      {total.toLocaleString("pt-PT")} dias em {year}
                    </p>
                  </div>
                  <label className="block text-sm">
                    <span className="mb-1 block text-paper/70">Férias do ano</span>
                    <input
                      className="field w-24"
                      type="number"
                      name="base_days"
                      min={0}
                      max={60}
                      step={0.5}
                      defaultValue={p.balance.baseDays}
                      required
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-paper/70">Transitados</span>
                    <input
                      className="field w-24"
                      type="number"
                      name="carried_days"
                      min={0}
                      max={60}
                      step={0.5}
                      defaultValue={p.balance.carriedDays}
                      required
                    />
                  </label>
                  <label className="flex items-center gap-2 pb-2.5 text-sm text-paper/70">
                    <input
                      type="checkbox"
                      name="birthday_day"
                      defaultChecked={p.balance.birthdayDay > 0}
                      className="h-4 w-4 accent-accent"
                    />
                    Dia de aniversário
                  </label>
                </ActionForm>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
