import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/admin-queries";
import { getManagedBalances, getPendingRequests } from "@/lib/leave-queries";
import { LeaveRequests } from "@/components/admin/LeaveRequests";
import { LeaveBalances } from "@/components/admin/LeaveBalances";

export const dynamic = "force-dynamic";

/** Anos oferecidos para os saldos: o atual e o seguinte (para o planear). */
function anos(): number[] {
  const atual = new Date().getFullYear();
  return [atual, atual + 1];
}

export default async function LeaveRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const me = await getCurrentProfile();
  if (!me) redirect("/admin/login");
  // Só quem decide férias entra aqui; os outros nem veem o separador.
  if (me.role !== "admin" && me.role !== "chefe") redirect("/admin/perfil");

  const disponiveis = anos();
  const pedido = Number((await searchParams).ano);
  const year = disponiveis.includes(pedido) ? pedido : disponiveis[0]!;

  const [requests, balances] = await Promise.all([
    getPendingRequests(),
    getManagedBalances(year),
  ]);

  return (
    <div className="space-y-8">
      <LeaveRequests requests={requests} />
      <LeaveBalances year={year} years={disponiveis} people={balances} />
    </div>
  );
}
