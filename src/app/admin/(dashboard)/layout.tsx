import { filterByVehicleType, getAllowedVehicleTypes, getSiteVehicleTypes } from "@/lib/vehicle-context";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/admin-queries";
import { effectiveSections } from "@/lib/permissions";
import { Sidebar } from "@/components/admin/Sidebar";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { AdminDock } from "@/components/admin/AdminDock";
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
  const [allowedTypes, siteTypes] = await Promise.all([getAllowedVehicleTypes(), getSiteVehicleTypes()]);
  const { error: schemaError } = await supabase.rpc("has_section", {section:"dashboard"});
  if (schemaError) return <main className="mx-auto max-w-xl space-y-4 px-6 py-16 text-paper">
    <h1 className="text-2xl font-bold">{schemaError.code === "PGRST202" ? "Atualização do backoffice pendente" : "Backoffice temporariamente indisponível"}</h1>
    <p>{schemaError.code === "PGRST202" ? "Esta versão precisa da atualização da base de dados antes de poder ser utilizada. Peça ao responsável técnico para concluir a ativação." : "Não foi possível verificar a ligação ao serviço. Tente novamente dentro de momentos."}</p>
    <p className="text-sm text-paper/60">Os dados existentes permanecem guardados.</p>
  </main>;
  // Contactos novos de tudo o que o utilizador pode ver (carros, motas e os
  // sem tipo), para o menu e o sino: o backoffice é um só.
  const [newLeads, settings] = await Promise.all([
    filterByVehicleType(
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "new"),
      allowedTypes,
    ),
    supabase
      .from("site_settings")
      .select("company_name")
      .eq("id", 1)
      .maybeSingle(),
  ]);
  const count = newLeads.count ?? 0;
  const companyName = settings.data?.company_name ?? "Supermotas";
  const user = {
    name: profile.full_name || profile.email || "Utilizador",
    role: profile.role,
  };
  const sections = effectiveSections(profile.role, profile.allowed_sections);

  return (
    <div className="admin-shell min-h-dvh text-paper">
      {/* Sem invólucro: o `sticky` da barra precisa de ter como pai a página inteira. */}
      <MobileNav user={user} sections={sections} companyName={companyName} newLeads={count ?? 0}/>
      {/* Em desktop: faixa de vidro no topo, barra de ícones à esquerda e pílula
          de atalhos em baixo, todas a flutuar. Safe-area para o modo app. */}
      <div className="hidden md:block">
        <div className="fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-30">
          <AdminTopBar user={user} companyName={companyName} newLeads={count ?? 0} showLeads={sections.includes("leads")} />
        </div>
        <div className="fixed bottom-24 left-[max(1rem,env(safe-area-inset-left))] top-[5.5rem] z-30">
          <Sidebar sections={sections} newLeads={count ?? 0} />
        </div>
        <AdminDock sections={sections} canCreate={allowedTypes.some((t) => siteTypes.includes(t))} />
      </div>
      <main className="min-w-0 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:pb-28 md:pl-[7.5rem] md:pt-[6rem]"><div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-4 lg:px-10">{children}</div></main>
    </div>
  );
}
