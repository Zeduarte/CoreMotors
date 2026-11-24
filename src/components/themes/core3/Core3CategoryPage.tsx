import { Suspense } from "react";
import { getSiteVehicleTypes, getVehicles } from "@/lib/queries";
import { toListVehicle } from "@/lib/vehicle-list";
import { mediaFor } from "@/lib/media";
import { asset } from "@/lib/asset";
import { kindOf, type StockKind } from "@/themes/core2/stock";
import { core2Serif } from "@/themes/core2/fonts";
import { categoryOf } from "@/themes/core3/ui";
import { Core2Stock } from "@/components/themes/core2/Core2Stock";
import { Core3Banner } from "./Core3Banner";

/**
 * Uma página de stock do Core3 (Motas, Moto 4, Carros): o topo com a foto, e
 * por baixo o stock do Core2 (filtros e cartões) só com este tipo. Sem a
 * secção «Tipo» nos filtros: o tipo é o da página.
 */
export async function Core3CategoryPage({ kind }: { kind: StockKind }) {
  const [siteTypes, all] = await Promise.all([getSiteVehicleTypes(), getVehicles()]);
  const cat = categoryOf(kind);
  const vehicles = all
    .filter((v) => siteTypes.includes(v.vehicleType ?? "car") && kindOf(v) === kind)
    .map((v) => ({ ...toListVehicle(v), tagline: v.tagline }));

  return (
    <div className={core2Serif.variable}>
      <Core3Banner
        // As motas e a Moto 4 usam a foto do topo das motas do site.
        photo={cat.hero ?? asset(mediaFor("motorcycle").entrada)}
        title={cat.title}
        subtitle={cat.subtitle}
        mobilePosition={cat.heroMobilePosition}
        crumbs={[{ label: "Início", href: "/" }, { label: cat.short, href: cat.href }, { label: cat.title }]}
      />
      {/* `useSearchParams` (os filtros no endereço) pede um Suspense numa página estática. */}
      <Suspense fallback={null}>
        <Core2Stock vehicles={vehicles} siteTypes={siteTypes} fixedKinds={[]} />
      </Suspense>
    </div>
  );
}
