import { redirect } from "next/navigation";
import { getPublicVehicleType, getVehicleSelection } from "@/lib/vehicle-context";
import { inventoryRedirect } from "@/lib/inventory-redirect";
import type { Metadata } from "next";
import Image from "next/image";
import { mediaFor } from "@/lib/media";
import { asset } from "@/lib/asset";
import { getVehicles } from "@/lib/queries";
import { inventoryWithOlx } from "@/lib/olx/search";
import { filtersFromQuery, sortFromQuery } from "@/lib/vehicles";
import { InventoryClient } from "@/components/inventory/InventoryClient";
import { SeoLinks } from "@/components/seo/SeoLinks";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Stock",
  alternates: { canonical: "/inventario" },
  description:
    "Explore o stock completo de motas e automóveis da Supermotas. Filtre por marca, modelo, preço, ano, combustível e quilómetros.",
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const vehicleType = await getPublicVehicleType();
  // Muda o mundo e volta com a mesma pesquisa (sem o `tipo`). Normalmente já
  // o fez o next.config.mjs, com um 307; aqui fica de reserva.
  const switchWorld = inventoryRedirect(
    new URLSearchParams(
      Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"),
    ),
    (await getVehicleSelection()) ?? undefined,
  );
  if (switchWorld) redirect(switchWorld);
  // Stock leve para os cartões, com os valores dos campos do OLX pesquisáveis.
  const { vehicles, fields: olxFields } = await inventoryWithOlx(await getVehicles(vehicleType), vehicleType);

  // Filtros vindos do endereço: a pesquisa rápida da página inicial, um link
  // partilhado ou o «voltar» da ficha (?marca=Yamaha&preco_max=8000…).
  const initialFilters = { ...filtersFromQuery(sp), vehicleType };

  const world = vehicleType ?? "car";

  return (
    <div className="container-px pb-24 pt-6 md:pt-10">
      <InventoryClient
        header={
          <>
            {/* Fundo do cartão: a foto do mundo (carros/motas) a desvanecer. */}
            <div aria-hidden className="absolute inset-0 md:left-[35%]">
              <Image
                src={asset(mediaFor(world).entrada)}
                alt=""
                fill
                priority
                sizes="(max-width: 768px) 100vw, 1100px"
                className="object-cover object-center opacity-60"
              />
            </div>
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-ink-soft via-ink-soft/90 to-ink-soft/60 md:bg-gradient-to-r md:from-ink-soft md:from-35% md:via-ink-soft/75 md:via-55% md:to-ink-soft/20"
            />
            <h1 className="sr-only">
              {vehicleType === "car"
                ? "Carros disponíveis"
                : vehicleType === "motorcycle"
                  ? "Motas disponíveis"
                  : "Todas as viaturas disponíveis"}
            </h1>
          </>
        }
        key={JSON.stringify(initialFilters)}
        vehicles={vehicles}
        initialFilters={initialFilters}
        initialSort={sortFromQuery(sp)}
        olxFields={olxFields}
      />

      {/* Pesquisas populares: páginas por marca, categoria e preço (Google). */}
      <SeoLinks type={world} vehicles={vehicles} className="mt-20" />
    </div>
  );
}
