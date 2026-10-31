import Link from "next/link";
import { getAdminCars } from "@/lib/admin-queries";
import { requireSection } from "@/lib/guard";
import { coverImage } from "@/lib/mappers";
import { CarsTable, type CarListItem } from "@/components/admin/CarsTable";

export const dynamic = "force-dynamic";

export default async function CarsPage() {
  const me = await requireSection("carros");
  const cars = await getAdminCars();

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
        <Link href="/admin/carros/novo" className="btn-primary">
          ＋ Nova viatura
        </Link>
      </div>

      <CarsTable items={items} isAdmin={me.role === "admin"} />
    </>
  );
}
