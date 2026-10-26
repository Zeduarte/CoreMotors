import { getAdminVehicleType, getAllowedVehicleTypes } from "@/lib/vehicle-context";
import { AdminWorldBar } from "@/components/admin/AdminWorldBar";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/admin-queries";
import { effectiveSections } from "@/lib/permissions";
import { Sidebar } from "@/components/admin/Sidebar";
import { MobileNav } from "@/components/admin/MobileNav";

export const dynamic = "force-dynamic";

/**
 * Shell autenticada do backoffice. Dupla proteção (além do middleware): sem
 * sessão → login. Layout de duas colunas em desktop, topo colapsado em mobile.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/admin/login");

  const supabase = await createClient();
  const vehicleType = await getAdminVehicleType();
  const allowedTypes = await getAllowedVehicleTypes();
  const { error: schemaError } = await supabase.rpc("has_section", {section:"dashboard"});
  if (schemaError) return <main className="mx-auto max-w-xl space-y-4 px-6 py-16 text-paper">
    <h1 className="text-2xl font-bold">{schemaError.code === "PGRST202" ? "Atualização do backoffice pendente" : "Backoffice temporariamente indisponível"}</h1>
    <p>{schemaError.code === "PGRST202" ? "Esta versão precisa da atualização da base de dados antes de poder ser utilizada. Peça ao responsável técnico para concluir a ativação." : "Não foi possível verificar a ligação ao serviço. Tente novamente dentro de momentos."}</p>
    <p className="text-sm text-paper/60">Os dados existentes permanecem guardados.</p>
  </main>;
  const [{ count }, settings] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "new").eq("vehicle_type", vehicleType),
    supabase
      .from("site_settings")
      .select("company_name")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  const companyName = settings.data?.company_name ?? "CoreMotors";
  const user = {
    name: profile.full_name || profile.email || "Utilizador",
    role: profile.role,
  };
  const sections = effectiveSections(profile.role, profile.allowed_sections);

  return (
    <div className="min-h-dvh bg-ink text-paper">
      <div className="md:hidden"><MobileNav user={user} sections={sections} companyName={companyName} newLeads={count ?? 0}/></div>
      <div className="md:grid md:grid-cols-[248px_1fr]">
        {/* Safe-area insets: em modo app (viewport-fit=cover) nada fica por baixo
            do notch, da barra de estado ou da barra inicial do iPhone/iPad. */}
        <div className="sticky top-0 hidden h-dvh pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] md:block bg-ink-soft"><Sidebar user={user} sections={sections} companyName={companyName} newLeads={count ?? 0}/></div>
        <main className="min-w-0 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:pl-0 md:pt-[env(safe-area-inset-top)]"><div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8 lg:px-10"><AdminWorldBar world={vehicleType} allowed={allowedTypes} />{children}</div></main>
      </div>
    </div>
  );
}
