import { getPublicVehicleType, getSiteVehicleTypes } from "@/lib/vehicle-context";
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
    "Explore o stock completo de automóveis e motas da Supermotas. Filtre por marca, modelo, preço, ano, combustível e quilómetros.",
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  // Um só stock: carros e motas juntos (os tipos que o site vende). O filtro
  // «Todos · Carros · Motas» está no próprio stock (`?tipo=`).
  const [world, siteTypes] = await Promise.all([getPublicVehicleType(), getSiteVehicleTypes()]);
  // Filtros vindos do endereço: a pesquisa rápida da página inicial, um link
  // partilhado ou o «voltar» da ficha (?tipo=motas&marca=Yamaha…).
  const fromQuery = filtersFromQuery(sp);
  // Num site de um só tipo, o tipo fica fixo (mostra as categorias desse tipo).
  const vehicleType =
    siteTypes.length === 1
      ? siteTypes[0]!
      : fromQuery.vehicleType && siteTypes.includes(fromQuery.vehicleType)
        ? fromQuery.vehicleType
        : null;
  // Stock leve para os cartões, com os valores dos campos do OLX pesquisáveis.
  const { vehicles, fields: olxFields } = await inventoryWithOlx(await getVehicles(), vehicleType ?? world);
  const initialFilters = { ...fromQuery, vehicleType };

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
        vehicleTypes={siteTypes}
      />

      {/* Pesquisas populares: páginas por marca, categoria e preço (Google),
          uma caixa por cada tipo que o site vende. */}
      {siteTypes.map((t) => (
        <SeoLinks
          key={t}
          type={t}
          vehicles={vehicles.filter((v) => (v.vehicleType ?? "car") === t)}
          className="mt-20"
        />
      ))}
    </div>
  );
}
