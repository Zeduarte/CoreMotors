import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/admin-queries";
import { getBalance, getCompanyDayRows, getCompanyDays, getLeaveDays } from "@/lib/leave-queries";
import { LeaveCalendar } from "@/components/admin/LeaveCalendar";
import { CompanyDaysManager } from "@/components/admin/CompanyDaysManager";
import { canAccess, leaveSelfApproves } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** Anos oferecidos no seletor: o anterior, o atual e o seguinte. */
function anos(): number[] {
  const atual = new Date().getFullYear();
  return [atual - 1, atual, atual + 1];
}

export default async function MyLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const me = await getCurrentProfile();
  if (!me) redirect("/admin/login");

  const disponiveis = anos();
  const pedido = Number((await searchParams).ano);
  const year = disponiveis.includes(pedido) ? pedido : new Date().getFullYear();

  // O calendário da empresa é de quem tem Definições (é o RLS da 0021).
  const gereCalendario = canAccess(me.role, me.allowed_sections, "definicoes");
  const [balance, days, extras, diasEmpresa] = await Promise.all([
    getBalance(me.id, year),
    getLeaveDays(me.id, year),
    getCompanyDays(year),
    gereCalendario ? getCompanyDayRows(year) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-10">
      <LeaveCalendar
        year={year}
        years={disponiveis}
        balance={balance}
        days={days}
        extras={extras}
        selfApproves={leaveSelfApproves(me.role)}
      />
      {gereCalendario && <CompanyDaysManager year={year} days={diasEmpresa} />}
    </div>
  );
}
