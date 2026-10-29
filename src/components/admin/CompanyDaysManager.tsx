"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionForm, Field } from "@/components/admin/ActionForm";
import { addCompanyDay, removeCompanyDay } from "@/lib/actions/leave";
import { COMPANY_DAY_LABEL, type CompanyDayKind } from "@/lib/leave";
import type { CompanyDayRow } from "@/lib/leave-queries";

/**
 * Dias especiais da empresa: o que os feriados nacionais não cobrem (feriado
 * municipal, tolerância de ponto, fecho obrigatório). Aparecem no calendário
 * de toda a gente; um dia obrigatório sai do saldo de cada um.
 */
export function CompanyDaysManager({ year, days }: { year: number; days: CompanyDayRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function remover(id: string) {
    if (!confirm("Retirar este dia do calendário da empresa?")) return;
    start(async () => {
      const res = await removeCompanyDay(id);
      if (res.ok) {
        toast.success("Dia retirado.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Não foi possível retirar o dia.");
      }
    });
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-paper">Dias da empresa em {year}</h2>
        <p className="text-sm text-paper/50">
          Os feriados nacionais já estão no calendário. Junte aqui o feriado
          municipal, as tolerâncias e os dias de fecho obrigatório.
        </p>
      </div>

      {days.length > 0 && (
        <ul className="card divide-y divide-white/5 p-0 text-sm">
          {days.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-paper">
                {new Date(`${d.day}T12:00:00`).toLocaleDateString("pt-PT", {
                  weekday: "short",
                  day: "2-digit",
                  month: "long",
                })}
                <span className="ml-2 text-paper/50">
                  {COMPANY_DAY_LABEL[d.kind]}
                  {d.label ? ` · ${d.label}` : ""}
                </span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => remover(d.id)}
                aria-label="Retirar dia"
                className="shrink-0 rounded-md px-2 py-1 text-xs text-paper/40 hover:bg-red-500/15 hover:text-red-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <ActionForm action={addCompanyDay} label="Juntar dia" success="Dia guardado.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Dia">
            <input
              className="field"
              type="date"
              name="day"
              min={`${year}-01-01`}
              max={`${year}-12-31`}
              required
            />
          </Field>
          <Field label="Tipo">
            <select className="field" name="kind" defaultValue="holiday">
              {(Object.keys(COMPANY_DAY_LABEL) as CompanyDayKind[]).map((k) => (
                <option key={k} value={k}>
                  {COMPANY_DAY_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Descrição (opcional)">
            <input className="field" name="label" maxLength={80} placeholder="Ex.: Feriado municipal" />
          </Field>
        </div>
      </ActionForm>
    </section>
  );
}
