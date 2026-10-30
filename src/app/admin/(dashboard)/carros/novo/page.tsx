import { getAllowedVehicleTypes, getVehicleSelection } from "@/lib/vehicle-context";
import { requireSection } from "@/lib/guard";
import { getShowroomContent } from "@/lib/showroom-queries";
import Link from "next/link";
import { CarForm } from "@/components/admin/CarForm";
import { getOlxFieldsForForm } from "@/lib/olx/field-queries";
import { getBadges } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function NewCarPage() {
  const me = await requireSection("carros");
  // O tipo escolhido no backoffice, só se o utilizador o puder gerir; com um
  // único tipo permitido, é esse.
  const [selected, allowedTypes] = await Promise.all([getVehicleSelection("admin"), getAllowedVehicleTypes()]);
  const vehicleType = selected && allowedTypes.includes(selected)
    ? selected
    : allowedTypes.length === 1 ? allowedTypes[0]! : null;
  const [showroom, olxFields, badgeOptions] = await Promise.all([getShowroomContent(), getOlxFieldsForForm(), getBadges()]);
  return (
    <>
      <div className="mb-6">
        <Link
          href="/admin/carros"
          className="text-sm text-paper/50 hover:text-paper"
        >
          ← Viaturas
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-paper">Nova viatura</h1>
        <p className="mt-1 text-sm text-paper/50">
          Escolha primeiro se pretende anunciar um carro ou uma mota. Depois de
          criar o anúncio, poderá adicionar fotografias e vídeo.
        </p>
      </div>
      <CarForm allowedTypes={allowedTypes} isAdmin={me.role === "admin"} locations={showroom.locations} olxFields={olxFields} badgeOptions={badgeOptions} defaults={vehicleType ? {vehicle_type:vehicleType,body:vehicleType === "motorcycle" ? "Naked" : "Berlina",doors:vehicleType === "motorcycle" ? 0 : 5,seats:vehicleType === "motorcycle" ? 2 : 5} : undefined} />
    </>
  );
}
