import { getPublicVehicleType } from "@/lib/vehicle-context";
import type { HeroMedia } from "@/lib/hero-media";
import { getShowroomContent } from "@/lib/showroom-queries";
import { FaqSection } from "@/components/showroom/FaqSection";
import { ServiceCards } from "@/components/showroom/ServiceCards";
import { GoogleReviews } from "@/components/showroom/GoogleReviews";
import { Hero } from "@/components/hero/Hero";
import { BrandMarquee } from "@/components/home/BrandMarquee";
import { QuickSearch } from "@/components/home/QuickSearch";
import { FeaturedVehicles } from "@/components/home/FeaturedVehicles";
import { Segments } from "@/components/home/Segments";
import { HomeStock } from "@/components/home/HomeStock";
import { PinnedTrust } from "@/components/home/PinnedTrust";
import { SoldShowcase } from "@/components/home/SoldShowcase";
import { ContactCTA } from "@/components/home/ContactCTA";
import { SellCTA } from "@/components/home/SellCTA";
import { Testimonials } from "@/components/home/Testimonials";
import {
  getHomeContent,
  getTestimonials,
  getBranding,
  getVehicles,
  getSoldVehicles,
} from "@/lib/queries";
import { existingMedia, getHeroMedia } from "@/lib/hero-media";
import { OPTIONAL_MEDIA } from "@/lib/media";
import { bodiesFor } from "@/lib/vehicle-categories";
import { brandOptions, sameBrand } from "@/lib/brand-name";

// ISR: revalida a cada 60s — novos destaques e edições de conteúdo aparecem
// sem rebuild manual.
export const revalidate = 60;

// Server Component: os dados (destaques + conteúdo editável) são obtidos no
// servidor e passados às ilhas cliente. Zero JS de dados enviado para o browser.
export default async function HomePage() {
  const type = await getPublicVehicleType();
  const [showroom, content, testimonials, branding, allVehicles, sold] =
    await Promise.all([
      getShowroomContent(),
      getHomeContent(),
      getTestimonials(),
      getBranding(),
      getVehicles(),
      getSoldVehicles(10),
    ]);

  // Dados mínimos para a pesquisa rápida (marca/modelo/combustível + contagem).
  const searchItems = allVehicles.map((v) => ({
    make: v.make,
    model: v.model,
    fuel: v.fuel,
    transmission: v.transmission,
  }));

  // «Que segmento procura?»: só as categorias com viaturas em stock.
  const bodyCounts = allVehicles.reduce<Record<string, number>>((acc, v) => {
    acc[v.body] = (acc[v.body] ?? 0) + 1;
    return acc;
  }, {});
  const segments = bodiesFor(type)
    .filter((body) => bodyCounts[body])
    .map((body) => ({ body, count: bodyCounts[body]! }));

  // Marcas em stock — cada uma na faixa leva ao stock dessa marca. Nos carros
  // a faixa é a lista do backoffice, mais as marcas em stock que lá faltem.
  const stockBrands = brandOptions(allVehicles.map((v) => v.make));
  const marqueeBrands =
    type === "motorcycle"
      ? stockBrands
      : [
          ...content.brands,
          ...stockBrands.filter((b) => !content.brands.some((c) => sameBrand(c, b))),
        ];

  // A definição do backoffice (vídeo/imagem) é a dos carros; as motas detetam pelo ficheiro.
  const heroMedia: HeroMedia = getHeroMedia(type === "motorcycle" ? "auto" : content.hero.media, type);
  // As motas têm o seu próprio topo, editável no backoffice (Página inicial).
  const heroContent = type === "motorcycle" ? { ...content.hero, ...content.motoHero } : content.hero;

  return (
    <>
      <Hero
        content={heroContent}
        media={heroMedia}
        search={
          allVehicles.length > 0 ? <QuickSearch vehicles={searchItems} /> : null
        }
      />

      <Segments segments={segments} />
      {/* A lista vem com as marcadas como destaque primeiro, depois as mais
          recentes. */}
      <FeaturedVehicles vehicles={allVehicles} total={allVehicles.length} />
      <BrandMarquee
        brands={marqueeBrands}
        available={stockBrands}
      />
      <HomeStock vehicles={allVehicles} />
      <SellCTA vehicleType={type} />
      <PinnedTrust
        content={content.trust}
        video={existingMedia(type, OPTIONAL_MEDIA.confianca)}
        poster={existingMedia(type, OPTIONAL_MEDIA.confiancaPoster)}
      />
      <SoldShowcase vehicles={sold} />
      <div className="container-px">
        <ServiceCards items={showroom.services} />
        <GoogleReviews config={showroom.google} />
        <FaqSection
          items={showroom.faqs.filter((f) => f.category === "geral")}
        />
      </div>
      <Testimonials items={testimonials} />
      <ContactCTA
        content={content.cta}
        company={branding.company}
        background={existingMedia(type, OPTIONAL_MEDIA.contacto)}
      />
    </>
  );
}
