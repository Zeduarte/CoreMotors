import { getShowroomContent } from "@/lib/showroom-queries";
import { registrationLabel } from "@/lib/vehicle-categories";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getVehicleBySlug,
  getAllSlugs,
  getBranding,
  getVehicleList,
} from "@/lib/queries";
import { VehicleCard } from "@/components/vehicle/VehicleCard";
import { formatKm, priceLabel } from "@/lib/format";
import { Gallery } from "@/components/vehicle/Gallery";
import { Specs } from "@/components/vehicle/Specs";
import { SpecGrid } from "@/components/vehicle/SpecGrid";
import { VehicleTabs, type VehiclePlace } from "@/components/vehicle/VehicleTabs";
import { ExtrasGroups } from "@/components/vehicle/ExtrasGroups";
import { TransparencySection } from "@/components/vehicle/TransparencySection";
import { ViewTracker } from "@/components/vehicle/ViewTracker";
import { VehicleWorldSync } from "@/components/site/VehicleWorldSync";
import { ShareButton } from "@/components/vehicle/ShareButton";
import { FavoriteButton } from "@/components/inventory/FavoriteButton";
import { RecentlyViewed } from "@/components/vehicle/RecentlyViewed";
import { SellCTA } from "@/components/home/SellCTA";
import { ContactBar } from "@/components/vehicle/ContactBar";
import { InterestCard } from "@/components/vehicle/InterestCard";
import { PriceSummary, visibleViews } from "@/components/vehicle/PriceSummary";
import { VehiclePrice } from "@/components/vehicle/VehiclePrice";
import { getRecentViews } from "@/lib/vehicle-views";
import { safely } from "@/lib/public-cache";
import { site } from "@/lib/site";
import { VehicleJsonLd } from "@/components/seo/VehicleJsonLd";
import { addressLine, getVisitsEnabled } from "@/lib/visit-run";

// ISR: páginas conhecidas são pré-geradas; novas viaturas publicadas depois do
// build são renderizadas on-demand e cacheadas (dynamicParams = true, default).
export const revalidate = 60;

// Em Next 15, `params` é assíncrono.
type Params = Promise<{ slug: string }>;

/**
 * Gera uma página estática por viatura no build (SSG). Quando a fonte passar a
 * API, este método faz `fetch` da lista de slugs — o resto mantém-se.
 */
export async function generateStaticParams() {
  const slugs = await getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}

/** Metadata dinâmica por viatura (title, description, Open Graph com a capa). */
export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const vehicle = await getVehicleBySlug(slug);
  if (!vehicle) return { title: "Viatura não encontrada" };

  const title = `${vehicle.make} ${vehicle.model} ${vehicle.year}`;
  const description = `${vehicle.tagline} ${priceLabel(vehicle.price, vehicle.priceOnRequest)} · ${formatKm(vehicle.mileage)} · ${vehicle.fuel}.`;

  return {
    title,
    description,
    // As imagens Open Graph vêm de `opengraph-image.tsx` (geradas por viatura).
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function VehiclePage({ params }: { params: Params }) {
  const { slug } = await params;
  const vehicle = await getVehicleBySlug(slug);
  if (!vehicle) notFound();

  const [branding, recentViews, showroom, visitsEnabled] = await Promise.all([
    getBranding(),
    vehicle.id ? safely("getRecentViews", () => getRecentViews(vehicle.id!), null) : null,
    getShowroomContent(),
    safely("getVisitsEnabled", () => getVisitsEnabled(), false),
  ]);
  const canReserve =
    branding.reservationEnabled && vehicle.status === "published";

  // Onde está a viatura: o ponto de venda dela; se não tiver, o único stand
  // registado; senão, a morada da empresa.
  const { locations } = showroom;
  const pos =
    locations.find((p) => p.id === vehicle.pointOfSaleId) ??
    (locations.length === 1 ? locations[0] : undefined);
  const { address, geo } = branding.company;
  const place: VehiclePlace | null = pos
    ? {
        name: pos.name,
        address: pos.address,
        postalCode: pos.postalCode,
        city: pos.city,
        hours: pos.hours,
        phone: pos.phone,
        query:
          pos.latitude != null && pos.longitude != null
            ? `${pos.latitude},${pos.longitude}`
            : `${pos.address}, ${pos.postalCode} ${pos.city}, Portugal`,
      }
    : address.street
      ? {
          name: branding.companyName,
          address: address.street,
          postalCode: address.postalCode,
          city: address.city,
          hours: branding.company.hours,
          phone: branding.company.phone,
          query:
            geo.lat && geo.lng
              ? `${geo.lat},${geo.lng}`
              : `${address.street}, ${address.postalCode} ${address.city}, Portugal`,
        }
      : null;

  // Viaturas relacionadas: prioriza a mesma marca, depois preenche com outras.
  const all = await getVehicleList(vehicle.vehicleType ?? "car");
  const related = [
    ...all.filter((v) => v.slug !== vehicle.slug && v.make === vehicle.make),
    ...all.filter((v) => v.slug !== vehicle.slug && v.make !== vehicle.make),
  ].slice(0, 4);

  return (
    <>
      <VehicleJsonLd vehicle={vehicle} sellerName={branding.companyName} />
      <ViewTracker carId={vehicle.id} slug={vehicle.slug} />
      <VehicleWorldSync type={vehicle.vehicleType ?? "car"} />

      <article className="md:pt-8">
        <div className="container-px">
          {(vehicle.status === "reserved" || vehicle.status === "sold") && (
            <div
              className={`mb-5 mt-4 rounded-xl px-4 py-3 text-sm font-medium md:mt-0 ${
                vehicle.status === "sold"
                  ? "bg-red-500/15 text-red-300"
                  : "bg-amber-500/15 text-amber-300"
              }`}
            >
              {vehicle.status === "sold"
                ? "Esta viatura já foi vendida. Contacte-nos para viaturas semelhantes."
                : "Esta viatura está reservada. Fale connosco para entrar na lista de espera."}
            </div>
          )}

          {/* Primeiro ecrã.
                - Computador (xl): título por cima; fotos à esquerda (miniaturas
                  em coluna) e, à direita, o preço com o "Interessado?"
                  (WhatsApp primeiro) e as características. A foto estica até à
                  altura da coluna da direita e o último cartão desta estica até
                  ao fundo da foto: as duas acabam alinhadas.
                - Telemóvel/tablet: fotos primeiro, de ponta a ponta, depois o
                  título, o preço/contacto e as características. */}
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_25rem] xl:gap-x-6 xl:gap-y-5 2xl:grid-cols-[minmax(0,1fr)_28rem]">
            <header className="order-2 flex min-w-0 flex-col gap-3 md:flex-row md:items-end md:justify-between xl:order-none xl:col-span-2">
              <div className="min-w-0">
                <p className="eyebrow mb-1.5">
                  {registrationLabel(vehicle.year, vehicle.registrationMonth)} ·{" "}
                  {vehicle.body}
                </p>
                <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xl font-semibold text-paper md:text-3xl">
                  <span>
                    {vehicle.make} {vehicle.model}
                  </span>
                  {vehicle.variant && (
                    <span className="flex items-baseline gap-3 text-base font-normal text-paper/70 md:text-lg">
                      <span
                        aria-hidden
                        className="h-5 w-0.5 self-center bg-accent"
                      />
                      {vehicle.variant}
                    </span>
                  )}
                </h1>
                {/* Descrição breve (slogan definido no backoffice). */}
                {vehicle.tagline && (
                  <p className="mt-2 max-w-2xl text-sm font-light leading-relaxed text-paper/65 md:text-base">
                    {vehicle.tagline}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <FavoriteButton slug={vehicle.slug} variant="inline" />
                <ShareButton
                  title={`${vehicle.make} ${vehicle.model} ${vehicle.year}`}
                  text={`${vehicle.make} ${vehicle.model} ${vehicle.year} · ${priceLabel(vehicle.price, vehicle.priceOnRequest)}`}
                />
                {/* Pouco usada: não é pré-carregada (só ao clicar). */}
                <Link
                  href={`/viaturas/${vehicle.slug}/ficha`}
                  prefetch={false}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs font-medium text-paper/80 transition-colors hover:border-accent hover:text-accent"
                >
                  ⤓ Ficha PDF<span className="hidden sm:inline"> + QR</span>
                </Link>
              </div>
            </header>

            <div className="order-1 min-w-0 xl:order-none">
              <Gallery
                slug={vehicle.slug}
                images={vehicle.images}
                video={vehicle.video}
              />
            </div>

            {/* Telemóvel: primeiro os dados (preço e características), depois o
                "Interessado?". Computador: o cartão do contacto em cima e as
                características a esticar até ao fundo da foto. */}
            <aside className="order-3 flex min-w-0 flex-col gap-4 xl:order-none xl:gap-3">
              <div className="rounded-3xl bg-ink-soft p-5 xl:hidden">
                <PriceSummary
                  price={<VehiclePrice vehicle={vehicle} />}
                  warrantyMonths={vehicle.warrantyMonths}
                  views={visibleViews(recentViews, vehicle.status ?? "published")}
                />
              </div>
              <div className="flex flex-col xl:order-last xl:flex-1">
                <SpecGrid vehicle={vehicle} />
              </div>
              <div className="xl:order-first">
                <InterestCard
                  vehicleName={`${vehicle.make} ${vehicle.model} ${vehicle.year}`}
                  shortName={`${vehicle.make} ${vehicle.model}`}
                  vehicleId={vehicle.id}
                  url={`${site.url}/viaturas/${vehicle.slug}`}
                  status={vehicle.status ?? "published"}
                  company={branding.company}
                  price={<VehiclePrice vehicle={vehicle} />}
                  priceValue={vehicle.priceOnRequest ? null : vehicle.price}
                  warrantyMonths={vehicle.warrantyMonths}
                  recentViews={recentViews}
                  canReserve={canReserve}
                  depositAmount={branding.depositAmount}
                  visit={
                    visitsEnabled
                      ? {
                          companyName: place?.name ?? branding.companyName,
                          address: place
                            ? addressLine({ street: place.address, postalCode: place.postalCode, city: place.city })
                            : addressLine(branding.company.address),
                        }
                      : null
                  }
                />
              </div>
            </aside>
          </div>

          <div className="mt-10 xl:mt-12">
            <VehicleTabs
              description={vehicle.description}
              equipment={
                (vehicle.extras?.length ?? 0) > 0 ? (
                  <ExtrasGroups
                    extras={vehicle.extras}
                    className="grid items-start gap-5 lg:grid-cols-2"
                  />
                ) : null
              }
              specs={
                <div className="space-y-10">
                  <Specs vehicle={vehicle} />
                  <TransparencySection vehicle={vehicle} />
                </div>
              }
              place={place}
            />
          </div>
        </div>

        <div className="container-px">
          {/* Viaturas relacionadas */}
          {related.length > 0 && (
            <section className="mt-24">
              <h2 className="mb-8 text-2xl font-semibold text-paper">
                Viaturas relacionadas
              </h2>
              {/* 4 viaturas: 2×2 ou uma linha de 4, sem buracos. */}
              <div className="grid gap-x-6 gap-y-12 sm:grid-cols-2 min-[1400px]:grid-cols-4">
                {related.map((v) => (
                  <VehicleCard key={v.slug} vehicle={v} sharedTransition={false} />
                ))}
              </div>
            </section>
          )}

          {/* Vistas recentemente (histórico local do visitante) */}
          <RecentlyViewed vehicles={all} excludeSlug={vehicle.slug} />

        </div>

        {/* Retoma / encomenda no fim da ficha (tem o seu próprio contentor). */}
        <SellCTA />

        {/* Fora do fluxo: flutua sobre o anúncio de ponta a ponta e reserva
            sozinha o espaço que ocupa (ver `ContactBar`). */}
        <ContactBar vehicle={vehicle} company={branding.company} />
      </article>
    </>
  );
}
