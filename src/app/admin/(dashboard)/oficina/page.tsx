import { requireSection } from "@/lib/guard";
import { getWorkshopVehicles } from "@/lib/workshop";
import { WorkshopList } from "@/components/admin/WorkshopList";
import { getActiveVehicleTypes, getAllowedVehicleTypes } from "@/lib/vehicle-context";

export const dynamic = "force-dynamic";

export default async function OficinaPage() {
  await requireSection("oficina");
  const [vehicles, allowedTypes, activeTypes] = await Promise.all([getWorkshopVehicles(), getAllowedVehicleTypes(), getActiveVehicleTypes()]);

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
      <WorkshopList vehicles={vehicles} allowedTypes={allowedTypes} creatableTypes={activeTypes} />
    </>
  );
}
