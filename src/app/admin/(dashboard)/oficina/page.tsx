import { requireSection } from "@/lib/guard";
import { getWorkshopVehicles } from "@/lib/workshop";
import { WorkshopList } from "@/components/admin/WorkshopList";
import { getActiveVehicleTypes, getAllowedVehicleTypes, getSiteVehicleTypes } from "@/lib/vehicle-context";
import { SiteTypeNotice } from "@/components/admin/SiteTypeNotice";

export const dynamic = "force-dynamic";

export default async function OficinaPage() {
  const me = await requireSection("oficina");
  const [vehicles, allowedTypes, activeTypes, siteTypes] = await Promise.all([getWorkshopVehicles(), getAllowedVehicleTypes(), getActiveVehicleTypes(), getSiteVehicleTypes()]);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-paper">Oficina</h1>
        <p className="mt-1 text-sm text-paper/50">
          Registe as horas de trabalho de cada viatura. Escolha uma viatura ou
          adicione uma nova pela matrícula. Quando estiver pronta, dê-a como
          preparada: sai da Oficina e passa para Viaturas.
        </p>
      </div>
      <SiteTypeNotice
        className="mb-6"
        allowedTypes={allowedTypes}
        siteTypes={siteTypes}
        isAdmin={me.role === "admin"}
      />
      <WorkshopList vehicles={vehicles} allowedTypes={allowedTypes} creatableTypes={activeTypes} />
    </>
  );
}
