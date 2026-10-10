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
import { PinnedTrust } from "@/components/home/PinnedTrust";
import { SoldShowcase } from "@/components/home/SoldShowcase";
import { ContactCTA } from "@/components/home/ContactCTA";
import { SellCTA } from "@/components/home/SellCTA";
import { Testimonials } from "@/components/home/Testimonials";
import {
  getRecentVehicles,
  getHomeContent,
  getTestimonials,
  getBranding,
  getVehicles,
  getSoldVehicles,
} from "@/lib/queries";
import { existingMedia, getHeroMedia } from "@/lib/hero-media";
import { OPTIONAL_MEDIA } from "@/lib/media";

// ISR: revalida a cada 60s — novos destaques e edições de conteúdo aparecem
// sem rebuild manual.
export const revalidate = 60;

// Server Component: os dados (destaques + conteúdo editável) são obtidos no
// servidor e passados às ilhas cliente. Zero JS de dados enviado para o browser.
export default async function HomePage() {
  const type = await getPublicVehicleType();
  const [showroom, recent, content, testimonials, branding, allVehicles, sold] =
    await Promise.all([
      getShowroomContent(),
      getRecentVehicles(),
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
  }));

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

      <BrandMarquee brands={type === "motorcycle" ? [...new Set(allVehicles.map(v=>v.make))] : content.brands} />
      <FeaturedVehicles vehicles={recent} />
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
