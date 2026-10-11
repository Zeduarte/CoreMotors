import { Locations } from "@/components/showroom/Locations";
import { getShowroomContent } from "@/lib/showroom-queries";
import { VehiclePrice } from "@/components/vehicle/VehiclePrice";
import { registrationLabel } from "@/lib/vehicle-categories";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getVehicleBySlug,
  getAllSlugs,
  getBranding,
  getVehicles,
} from "@/lib/queries";
import { VehicleCard } from "@/components/vehicle/VehicleCard";
import { formatKm, priceLabel } from "@/lib/format";
import { Gallery } from "@/components/vehicle/Gallery";
import { Specs } from "@/components/vehicle/Specs";
import { SpecGrid } from "@/components/vehicle/SpecGrid";
import { DescriptionCard } from "@/components/vehicle/DescriptionCard";
import { ExtrasGroups } from "@/components/vehicle/ExtrasGroups";
import { TransparencySection } from "@/components/vehicle/TransparencySection";
import { VehicleActions } from "@/components/vehicle/VehicleActions";
import { ViewTracker } from "@/components/vehicle/ViewTracker";
import { ShareButton } from "@/components/vehicle/ShareButton";
import { FavoriteButton } from "@/components/inventory/FavoriteButton";
import { RecentlyViewed } from "@/components/vehicle/RecentlyViewed";
import { SellCTA } from "@/components/home/SellCTA";
import { ContactBar } from "@/components/vehicle/ContactBar";
import { QuickContact } from "@/components/vehicle/QuickContact";
import { getRecentViews } from "@/lib/vehicle-views";
import { safely } from "@/lib/public-cache";
import { site } from "@/lib/site";
import { VehicleJsonLd } from "@/components/seo/VehicleJsonLd";

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

  const [branding, recentViews] = await Promise.all([
    getBranding(),
    vehicle.id ? safely("getRecentViews", () => getRecentViews(vehicle.id!), null) : null,
  ]);
  const canReserve =
    branding.reservationEnabled && vehicle.status === "published";

  // Viaturas relacionadas: prioriza a mesma marca, depois preenche com outras.
  const all = await getVehicles();
  const related = [
    ...all.filter((v) => v.slug !== vehicle.slug && v.make === vehicle.make),
    ...all.filter((v) => v.slug !== vehicle.slug && v.make !== vehicle.make),
  ].slice(0, 3);

  return (
    <>
      <VehicleJsonLd vehicle={vehicle} sellerName={branding.companyName} />
      <ViewTracker carId={vehicle.id} slug={vehicle.slug} />

      <article className="pt-24 md:pt-28">
        <div className="container-px">
          {(vehicle.status === "reserved" || vehicle.status === "sold") && (
            <div
              className={`mb-6 rounded-xl px-4 py-3 text-sm font-medium ${
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

          {/* Cabeçalho: identificação da viatura antes de qualquer foto. */}
          <header>
            {vehicle.warrantyMonths ? (
              <p className="mb-3 text-sm font-semibold text-paper/80">
                Garantia: {vehicle.warrantyMonths} meses
              </p>
            ) : null}

            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="eyebrow mb-2">
                  {registrationLabel(vehicle.year, vehicle.registrationMonth)} ·{" "}
                  {vehicle.body}
                </p>
                <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-headline font-semibold text-paper">
                  <span>
                    {vehicle.make} {vehicle.model}
                  </span>
                  {vehicle.variant && (
                    <span className="flex items-baseline gap-3 text-xl font-light text-paper/60">
                      <span
                        aria-hidden
                        className="h-6 w-0.5 self-center bg-accent"
                      />
                      {vehicle.variant}
                    </span>
                  )}
                </h1>

                {/* Descrição breve (slogan definido no backoffice). */}
                {vehicle.tagline && (
                  <p className="mt-3 max-w-xl text-lg font-light leading-relaxed text-paper/70">
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
                <Link
                  href={`/viaturas/${vehicle.slug}/ficha`}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs font-medium text-paper/80 transition-colors hover:border-accent hover:text-accent"
                >
                  ⤓ Ficha PDF + QR
                </Link>
              </div>
            </div>
          </header>

          {/* Foto e informação lado a lado no desktop (foto à esquerda, preço
              e especificações à direita). Em mobile a mesma ordem empilha-se:
              primeiro a fotografia, só depois a informação.

              `minmax(0,…)`: sem isto o mínimo de uma coluna `fr` é o seu
              min-content, e a tira de miniaturas da galeria esticava a coluna
              da foto até esmagar as especificações (texto cortado). */}
          <div className="mt-8 grid gap-8 min-[900px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-12">
            {/* `min-w-0` nos itens: em mobile a grelha é de uma coluna e o
                `minmax(0,…)` não se aplica — sem isto a tira de miniaturas
                (8 × 80px) empurrava a página para 724px de largura. */}
            <div className="min-w-0">
              <Gallery
                slug={vehicle.slug}
                images={vehicle.images}
                video={vehicle.video}
              />
            </div>

            <div className="min-w-0 space-y-8">
              <div className="rounded-3xl bg-ink-soft p-6">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-lg font-medium text-paper/70">
                    Preço de venda
                  </span>
                  <span className="text-3xl font-bold text-accent">
                    {<VehiclePrice vehicle={vehicle} />}
                  </span>
                </div>
              </div>

              {/* Contacto logo no primeiro ecrã, ao lado das fotos: quem
                  gostou não tem de procurar como falar connosco. */}
              <QuickContact
                vehicleName={`${vehicle.make} ${vehicle.model} ${vehicle.year}`}
                url={`${site.url}/viaturas/${vehicle.slug}`}
                status={vehicle.status ?? "published"}
                company={branding.company}
                recentViews={recentViews}
              />

              <SpecGrid vehicle={vehicle} />
            </div>
          </div>

          {/* Resto do conteúdo, com o painel de contacto fixo à direita */}
          <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-14">
            <div className="min-w-0 space-y-8 lg:space-y-10">
              {vehicle.description && (
                <DescriptionCard text={vehicle.description} />
              )}

              {/* "Interessado?" logo a seguir à descrição — só em mobile/tablet
                  (no desktop está no painel lateral fixo à direita). */}
              <div className="lg:hidden">
                <VehicleActions
                  vehicleName={`${vehicle.make} ${vehicle.model}`}
                  vehicleId={vehicle.id}
                  price={vehicle.priceOnRequest ? null : vehicle.price}
                  canReserve={canReserve}
                  depositAmount={branding.depositAmount}
                />
              </div>

              <ExtrasGroups extras={vehicle.extras} />

              <Specs vehicle={vehicle} />

              <TransparencySection vehicle={vehicle} />
            </div>

            <div className="hidden space-y-8 lg:block lg:sticky lg:top-28 lg:self-start">
              <VehicleActions
                vehicleName={`${vehicle.make} ${vehicle.model}`}
                vehicleId={vehicle.id}
                price={vehicle.priceOnRequest ? null : vehicle.price}
                canReserve={canReserve}
                depositAmount={branding.depositAmount}
              />
            </div>
          </div>

          <Locations
            items={(await getShowroomContent()).locations.filter(
              (p) => p.id === vehicle.pointOfSaleId,
            )}
          />
          {/* Viaturas relacionadas */}
          {related.length > 0 && (
            <section className="mt-24">
              <h2 className="mb-8 text-2xl font-semibold text-paper">
                Viaturas relacionadas
              </h2>
              <div className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((v) => (
                  <VehicleCard key={v.slug} vehicle={v} sharedTransition={false} />
                ))}
              </div>
            </section>
          )}

          {/* Vistas recentemente (histórico local do visitante) */}
          <RecentlyViewed vehicles={all} excludeSlug={vehicle.slug} />

          {/* Retoma / encomenda no fim da ficha */}
          <SellCTA />
        </div>

        {/* Fora do fluxo: flutua sobre o anúncio de ponta a ponta e reserva
            sozinha o espaço que ocupa (ver `ContactBar`). */}
        <ContactBar vehicle={vehicle} company={branding.company} />
      </article>
    </>
  );
}
