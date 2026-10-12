import type { Metadata } from "next";
import { getVehicleList } from "@/lib/queries";
import { FavoritesList } from "@/components/inventory/FavoritesList";

export const metadata: Metadata = {
  title: "Favoritos",
  description: "As viaturas que guardou para ver mais tarde.",
  robots: { index: false, follow: true },
};

export const revalidate = 60;

export default async function FavoritesPage() {
  const vehicles = await getVehicleList();

  return (
    <div className="container-px pb-24 pt-32 md:pt-40">
      <header className="mb-10">
        <p className="eyebrow mb-4">Os meus favoritos</p>
        <h1 className="text-headline font-semibold text-paper">
          Viaturas guardadas
        </h1>
      </header>
      <FavoritesList vehicles={vehicles} />
    </div>
  );
}
