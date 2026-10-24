import { redirect } from "next/navigation";
import { getPublicVehicleType, getVehicleSelection } from "@/lib/vehicle-context";
import { inventoryVehicleType } from "@/lib/vehicle-categories";
import type { Metadata } from "next";
import Image from "next/image";
import { mediaFor } from "@/lib/media";
import { asset } from "@/lib/asset";
import { formatPrice } from "@/lib/format";
import { getVehicles } from "@/lib/queries";
import { inventoryWithOlx } from "@/lib/olx/search";
import { filtersFromQuery, sortFromQuery } from "@/lib/vehicles";
import { InventoryClient } from "@/components/inventory/InventoryClient";
import { SeoLinks } from "@/components/seo/SeoLinks";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Stock",
  description:
    "Explore o stock completo de motas e automóveis da CoreMotors. Filtre por marca, modelo, preço, ano, combustível e quilómetros.",
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const requested = inventoryVehicleType(sp.tipo);
  const vehicleType = await getPublicVehicleType();
  if (requested && (requested !== vehicleType || !(await getVehicleSelection()))) {
    // Muda o mundo e volta com a mesma pesquisa (sem o `tipo`).
    const rest = new URLSearchParams(
      Object.entries(sp).filter((e): e is [string, string] => e[0] !== "tipo" && typeof e[1] === "string"),
    ).toString();
    redirect(`/api/vehicle-context?area=public&type=${requested}&target=${encodeURIComponent(`/inventario${rest ? `?${rest}` : ""}`)}`);
  }
  // Stock leve para os cartões, com os valores dos campos do OLX pesquisáveis.
  const { vehicles, fields: olxFields } = await inventoryWithOlx(await getVehicles(vehicleType), vehicleType);

  // Filtros vindos do endereço: a pesquisa rápida da página inicial, um link
  // partilhado ou o «voltar» da ficha (?marca=Yamaha&preco_max=8000…).
  const initialFilters = { ...filtersFromQuery(sp), vehicleType };

  // Números do topo (só do que está à venda agora).
  const brands = new Set(vehicles.map((v) => v.make)).size;
  const prices = vehicles.filter((v) => !v.priceOnRequest && v.price > 0).map((v) => v.price);
  const from = prices.length ? Math.min(...prices) : null;
  const world = vehicleType ?? "car";
  const stats = [
    { value: String(vehicles.length), label: vehicles.length === 1 ? "viatura" : "viaturas", labelFirst: false },
    { value: String(brands), label: brands === 1 ? "marca" : "marcas", labelFirst: false },
    ...(from ? [{ value: formatPrice(from), label: "desde", labelFirst: true }] : []),
  ];

  return (
    <div className="container-px pb-24 pt-6 md:pt-10">
      <InventoryClient
        header={
          // Topo do stock: a foto do mundo (carros/motas) a desvanecer para o
          // fundo, com o título à esquerda e os números do stock. Vai dentro
          // do mesmo cartão dos filtros.
          <header className="relative overflow-hidden rounded-t-3xl">
            <div className="absolute inset-0 md:left-[35%]">
              <Image
                src={asset(mediaFor(world).entrada)}
                alt=""
                fill
                priority
                sizes="(max-width: 768px) 100vw, 1100px"
                className="object-cover object-center opacity-75"
              />
            </div>
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-ink-soft via-ink-soft/85 to-ink-soft/30 md:bg-gradient-to-r md:from-ink-soft md:from-35% md:via-ink-soft/70 md:via-55% md:to-transparent"
            />
            <div className="relative flex flex-col gap-6 p-5 pt-20 md:min-h-[19rem] md:flex-row md:items-end md:justify-between md:gap-8 md:p-10">
              <div className="max-w-xl">
                <p className="eyebrow mb-4">Stock</p>
                <h1 className="text-headline font-semibold text-paper">
                  {vehicleType === "car"
                    ? "Carros disponíveis"
                    : vehicleType === "motorcycle"
                      ? "Motas disponíveis"
                      : "Todas as viaturas disponíveis"}
                </h1>
                <p className="mt-3 text-base font-light text-paper/70 md:mt-4 md:text-lg">
                  Selecionadas, revistas e prontas para entrega. Use os filtros para encontrar a sua.
                </p>
              </div>
              {/* Telemóvel: marcadores numa linha ("4 viaturas", "desde 7450 €");
                  computador: caixas com o rótulo por cima do número. */}
              <dl className="flex flex-wrap gap-2 md:gap-3">
                {stats.map((s) => (
                  <div
                    key={s.label}
                    className={`flex items-baseline gap-1.5 rounded-full ${s.labelFirst ? "" : "flex-row-reverse justify-end"} border border-white/10 bg-ink/60 px-3.5 py-2 backdrop-blur-md md:min-w-[8.5rem] md:flex-col md:items-start md:gap-1 md:rounded-2xl md:px-5 md:py-4`}
                  >
                    <dt className="text-sm text-paper/60 md:text-[11px] md:uppercase md:tracking-[0.18em] md:text-paper/50">
                      {s.label}
                    </dt>
                    <dd className="whitespace-nowrap text-sm font-semibold text-paper md:text-2xl">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </header>
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
