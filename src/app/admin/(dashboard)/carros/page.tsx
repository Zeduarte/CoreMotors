import Link from "next/link";
import { getAdminCars } from "@/lib/admin-queries";
import { requireSection } from "@/lib/guard";
import { coverImage } from "@/lib/mappers";
import { CarsTable, type CarListItem } from "@/components/admin/CarsTable";
import { typeChoice } from "@/components/admin/TypeFilter";
import { getActiveVehicleTypes, getAllowedVehicleTypes, getSiteVehicleTypes } from "@/lib/vehicle-context";
import { SiteTypeNotice } from "@/components/admin/SiteTypeNotice";

export const dynamic = "force-dynamic";

export default async function CarsPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>;
}) {
  const me = await requireSection("carros");
  // Carros e motas na mesma lista; o filtro «Todos · Carros · Motas» é local.
  const [cars, allowedTypes, activeTypes, siteTypes, { tipo }] = await Promise.all([
    getAdminCars(),
    getAllowedVehicleTypes(),
    getActiveVehicleTypes(),
    getSiteVehicleTypes(),
    searchParams,
  ]);

  const items: CarListItem[] = cars.map((c) => ({
    id: c.id,
    vehicleType: c.vehicle_type ?? "car",
    plate: c.license_plate,
    make: c.make,
    model: c.model,
    variant: c.variant,
    year: c.year,
    price: c.price,
    priceOnRequest: c.price_on_request,
    mileage: c.mileage,
    fuel: c.fuel,
    transmission: c.transmission,
    status: c.status,
    featured: c.featured,
    slug: c.slug,
    cover: coverImage(c),
    mediaCount: (c.car_media ?? []).length,
    updatedAt: c.updated_at,
  }));

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-paper">Viaturas</h1>
          <p className="mt-1 text-sm text-paper/50">
            {items.length} {items.length === 1 ? "viatura" : "viaturas"} no total
          </p>
        </div>
        {activeTypes.length > 0 && (
          <Link href="/admin/carros/novo" className="btn-primary">
            ＋ Nova viatura
          </Link>
        )}
      </div>
      <SiteTypeNotice
        className="mb-6"
        allowedTypes={allowedTypes}
        siteTypes={siteTypes}
        isAdmin={me.role === "admin"}
      />

      <CarsTable
        items={items}
        isAdmin={me.role === "admin"}
        allowedTypes={allowedTypes}
        siteTypes={siteTypes}
        // Um filtro de um tipo sem filtro à vista não deixa a lista vazia.
        initialType={
          allowedTypes.length > 1 ? typeChoice(tipo) : "todos"
        }
      />
    </>
  );
}
