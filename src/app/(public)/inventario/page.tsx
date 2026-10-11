import { redirect } from "next/navigation";
import { getPublicVehicleType, getVehicleSelection } from "@/lib/vehicle-context";
import { inventoryVehicleType } from "@/lib/vehicle-categories";
import type { Metadata } from "next";
import { getVehicles } from "@/lib/queries";
import { InventoryClient } from "@/components/inventory/InventoryClient";
import { StockAlertForm } from "@/components/inventory/StockAlertForm";
import type { FuelType, Transmission, VehicleFilters } from "@/types/vehicle";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Stock",
  description:
    "Explore o stock completo de motas e automóveis da Supermotas. Filtre por marca, modelo, preço, ano, combustível e quilómetros.",
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const requested = inventoryVehicleType(sp.tipo);
  const vehicleType = await getPublicVehicleType();
  if (requested && (requested !== vehicleType || !(await getVehicleSelection()))) redirect(`/api/vehicle-context?area=public&type=${requested}&target=%2Finventario`);
  const vehicles = await getVehicles(vehicleType);

  // Filtros iniciais vindos do URL (ex.: da pesquisa rápida da homepage).
  const initialFilters = {
    vehicleType,
    make: sp.make || null,
    model: sp.model || null,
    fuel: (sp.fuel as FuelType) || null,
    transmission: (sp.transmission as Transmission) || null,
    query: sp.q || null,
    // ?categoria=Moto%204 — link direto para uma categoria.
    body: (sp.categoria as VehicleFilters["body"]) || null,
  };

  return (
    <div className="container-px pb-24 pt-32 md:pt-40">
      <header className="mb-12 max-w-2xl">
        <p className="eyebrow mb-4">Stock</p>
        <h1 className="text-headline font-semibold text-paper">
          {vehicleType === "car"
            ? "Carros disponíveis"
            : vehicleType === "motorcycle"
              ? "Motas disponíveis"
              : "Todas as viaturas disponíveis"}
        </h1>
        <p className="mt-4 text-lg font-light text-paper/60">
          {vehicles.length} viaturas selecionadas, prontas para entrega. Use os
          filtros para encontrar a sua.
        </p>
      </header>

      <InventoryClient
        key={JSON.stringify(initialFilters)}
        vehicles={vehicles}
        initialFilters={initialFilters}
      />

      <section className="mt-20">
        <StockAlertForm defaultQuery={sp.q ?? ""} />
      </section>
    </div>
  );
}
