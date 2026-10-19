import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBranding, getVehicleList } from "@/lib/queries";
import { mediaFor } from "@/lib/media";
import { asset } from "@/lib/asset";
import { formatPrice } from "@/lib/format";
import { site } from "@/lib/site";
import { safeJsonLd } from "@/lib/json-ld";
import { distinctMakes, filtersToQuery } from "@/lib/vehicles";
import type { VehicleType } from "@/lib/vehicle-categories";
import { resolveSeoPage, seoIntro, seoPath, TYPE_PATH, usedLabel, type SeoPage } from "@/lib/seo-pages";
import { VehicleCard } from "@/components/vehicle/VehicleCard";
import { StockAlertForm } from "@/components/inventory/StockAlertForm";
import { SeoLinks } from "./SeoLinks";
import { emptyFilters } from "@/lib/vehicles";
import type { Vehicle } from "@/types/vehicle";

/**
 * Página de listagem para o Google: todas as motas (/motas), ou uma marca,
 * categoria, preço ou combustível (/motas/yamaha, /carros/suv, …).
 *
 * Mostra sempre o tipo do endereço, e não o da escolha guardada no browser.
 * Sem viaturas, fica o alerta de stock — e a página sai do índice do Google
 * (noindex) até voltar a haver stock, para não aparecer uma página vazia.
 */

async function load(type: VehicleType, slug: string | null) {
  const all = await getVehicleList(type);
  const page = slug ? resolveSeoPage(type, slug, all) : null;
  if (slug && !page) notFound();
  const vehicles = page ? all.filter(page.matches) : all;
  return { all, page, vehicles };
}

const fromPrice = (list: Vehicle[]) => {
  const prices = list.filter((v) => !v.priceOnRequest && v.price > 0).map((v) => v.price);
  return prices.length ? Math.min(...prices) : null;
};

export async function seoMetadata(type: VehicleType, slug: string | null): Promise<Metadata> {
  const [{ page, vehicles }, branding] = await Promise.all([load(type, slug), getBranding()]);
  const title = page?.title ?? usedLabel(type);
  const path = page ? seoPath(page) : `/${TYPE_PATH[type]}`;
  const description = seoIntro(page, type, vehicles.length, fromPrice(vehicles), branding.companyName);
  return {
    title,
    description,
    alternates: { canonical: `${site.url}${path}` },
    robots: vehicles.length ? undefined : { index: false, follow: true },
    openGraph: { title, description, type: "website", url: `${site.url}${path}` },
  };
}

function JsonLd({ type, page, vehicles }: { type: VehicleType; page: SeoPage | null; vehicles: Vehicle[] }) {
  const base = `${site.url}/${TYPE_PATH[type]}`;
  const crumbs = [
    { name: "Início", item: site.url },
    { name: usedLabel(type), item: base },
    ...(page ? [{ name: page.label, item: `${site.url}${seoPath(page)}` }] : []),
  ];
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.item })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: page?.title ?? usedLabel(type),
      numberOfItems: vehicles.length,
      itemListElement: vehicles.slice(0, 30).map((v, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${site.url}/viaturas/${v.slug}`,
        name: `${v.make} ${v.model} ${v.year}`,
      })),
    },
  ];
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}

export async function SeoListing({ type, slug }: { type: VehicleType; slug: string | null }) {
  const [{ all, page, vehicles }, branding] = await Promise.all([load(type, slug), getBranding()]);
  const from = fromPrice(vehicles);
  const typePath = `/${TYPE_PATH[type]}`;
  // O mesmo resultado no stock, com todos os filtros (muda o mundo se for preciso).
  const stockQuery = filtersToQuery({ ...emptyFilters(), ...(page?.filters ?? {}) });
  const stockHref = `/api/vehicle-context?area=public&type=${type}&target=${encodeURIComponent(
    `/inventario${stockQuery ? `?${stockQuery}` : ""}`,
  )}`;
  const stats = [
    { value: String(vehicles.length), label: vehicles.length === 1 ? (type === "car" ? "carro" : "mota") : type === "car" ? "carros" : "motas" },
    ...(from ? [{ value: formatPrice(from), label: "desde" }] : []),
  ];

  return (
    <div className="container-px pb-24 pt-6 md:pt-10">
      <JsonLd type={type} page={page} vehicles={vehicles} />

      <nav aria-label="Caminho" className="mb-4 text-sm text-paper/50">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-paper">
              Início
            </Link>
          </li>
          <li aria-hidden>›</li>
          <li>
            {page ? (
              <Link href={typePath} className="hover:text-paper">
                {usedLabel(type)}
              </Link>
            ) : (
              <span className="text-paper/80">{usedLabel(type)}</span>
            )}
          </li>
          {page && (
            <>
              <li aria-hidden>›</li>
              <li className="text-paper/80">{page.label}</li>
            </>
          )}
        </ol>
      </nav>

      <header className="relative mb-10 overflow-hidden rounded-3xl border border-white/10 bg-ink-soft">
        <div className="absolute inset-0 md:left-[35%]">
          <Image
            src={asset(mediaFor(type).entrada)}
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
        <div className="relative flex flex-col gap-6 p-5 pt-20 md:min-h-[17rem] md:flex-row md:items-end md:justify-between md:gap-8 md:p-10">
          <div className="max-w-2xl">
            <p className="eyebrow mb-4">{page ? usedLabel(type) : "Stock"}</p>
            <h1 className="text-headline font-semibold text-paper">{page?.title ?? usedLabel(type)}</h1>
            <p className="mt-3 text-base font-light text-paper/70 md:mt-4 md:text-lg">
              {seoIntro(page, type, vehicles.length, from, branding.companyName)}
            </p>
          </div>
          <dl className="flex flex-wrap gap-2 md:gap-3">
            {stats.map((s) => (
              <div
                key={s.label}
                className="flex items-baseline gap-1.5 rounded-full border border-white/10 bg-ink/60 px-3.5 py-2 backdrop-blur-md md:min-w-[8.5rem] md:flex-col md:items-start md:gap-1 md:rounded-2xl md:px-5 md:py-4"
              >
                <dt className="text-sm text-paper/60 md:text-[11px] md:uppercase md:tracking-[0.18em] md:text-paper/50">{s.label}</dt>
                <dd className="order-first whitespace-nowrap text-sm font-semibold text-paper md:order-none md:text-2xl">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      {vehicles.length > 0 && (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-paper/60">
              <span className="font-semibold text-paper">{vehicles.length}</span>{" "}
              {vehicles.length === 1 ? "viatura" : "viaturas"}
            </p>
            <a href={stockHref} className="text-sm font-medium text-accent hover:underline">
              Refinar com mais filtros →
            </a>
          </div>
          <div className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 min-[1400px]:grid-cols-4">
            {vehicles.map((v, i) => (
              <VehicleCard key={v.slug} vehicle={v} priority={i < 3} />
            ))}
          </div>
        </>
      )}

      <section id="alerta" className="mt-16 scroll-mt-28">
        <StockAlertForm
          vehicleType={type}
          makes={distinctMakes(all)}
          eyebrow={vehicles.length ? "Não encontrou a certa?" : "Sem stock de momento"}
          defaults={{
            make: page?.filters.make ?? null,
            body: page?.filters.body ?? null,
            fuel: page?.filters.fuel ?? null,
            max_price: page?.filters.maxPrice ?? null,
          }}
        />
      </section>

      <SeoLinks type={type} vehicles={all} current={page?.slug} className="mt-12" />
    </div>
  );
}
