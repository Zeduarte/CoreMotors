import { getPublicVehicleType, getSiteVehicleTypes } from "@/lib/vehicle-context";
import type { Metadata, ResolvingMetadata } from "next";
import Image from "next/image";
import { mediaFor } from "@/lib/media";
import { asset } from "@/lib/asset";
import { getBranding, getVehicles } from "@/lib/queries";
import type { VehicleType } from "@/lib/vehicle-categories";
import { pageMetadata } from "@/components/seo/page-metadata";
import { inventoryWithOlx } from "@/lib/olx/search";
import { filtersFromQuery, sortFromQuery } from "@/lib/vehicles";
import { InventoryClient } from "@/components/inventory/InventoryClient";
import { SeoLinks } from "@/components/seo/SeoLinks";

export const revalidate = 60;

export async function generateMetadata(
  _: unknown,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  // O nome do stand é o das Definições, como no resto da página.
  const { companyName } = await getBranding();
  return pageMetadata(parent, {
    title: "Stock",
    path: "/inventario",
    description: `Explore o stock completo da ${companyName}. Filtre por marca, modelo, preço, ano, combustível e quilómetros.`,
  });
}

/**
 * O topo do stock: a foto do tipo escolhido (carros ou motas; com «Todos», a
 * do tipo principal do site) a desvanecer, e o título para leitores de ecrã.
 */
function StockHeader({ photo, type }: { photo: VehicleType; type: VehicleType | null }) {
  return (
    <>
      <div aria-hidden className="absolute inset-0 md:left-[35%]">
        <Image
          src={asset(mediaFor(photo).entrada)}
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
        {type === "car"
          ? "Carros disponíveis"
          : type === "motorcycle"
            ? "Motas disponíveis"
            : "Todas as viaturas disponíveis"}
      </h1>
    </>
  );
}

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
  // Os campos do OLX são diferentes nos carros e nas motas: calculam-se para
  // cada tipo, e o stock mostra os do tipo escolhido.
  const all = await getVehicles();
  const perType = await Promise.all(
    siteTypes.map((t) => inventoryWithOlx(all.filter((v) => (v.vehicleType ?? "car") === t), t)),
  );
  const vehicles = perType.flatMap((p) => p.vehicles);
  const olxFieldsByType = Object.fromEntries(siteTypes.map((t, i) => [t, perType[i]!.fields]));
  const initialFilters = { ...fromQuery, vehicleType };

  return (
    <div className="container-px pb-24 pt-6 md:pt-10">
      <InventoryClient
        // A foto acompanha o tipo: ?tipo=motas (ou um site só de motas)
        // abre com a das motas, e trocar de tipo no stock troca-a também.
        header={<StockHeader photo={vehicleType ?? world} type={vehicleType} />}
        headerByType={
          siteTypes.length > 1
            ? {
                all: <StockHeader photo={world} type={null} />,
                ...Object.fromEntries(siteTypes.map((t) => [t, <StockHeader key={t} photo={t} type={t} />])),
              }
            : undefined
        }
        key={JSON.stringify(initialFilters)}
        vehicles={vehicles}
        initialFilters={initialFilters}
        initialSort={sortFromQuery(sp)}
        olxFieldsByType={olxFieldsByType}
        vehicleTypes={siteTypes}
      />

      {/* Pesquisas populares: páginas por marca, categoria e preço (Google),
          uma caixa por cada tipo que o site vende — com o tipo no título
          quando são duas («Pesquisas populares — motas»). */}
      {siteTypes.map((t) => (
        <SeoLinks
          key={t}
          type={t}
          vehicles={vehicles.filter((v) => (v.vehicleType ?? "car") === t)}
          showType={siteTypes.length > 1}
          className="mt-20"
        />
      ))}
    </div>
  );
}
