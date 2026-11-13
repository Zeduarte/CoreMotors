import type { Metadata, ResolvingMetadata } from "next";
import { pageMetadata } from "@/components/seo/page-metadata";
import { getPublicVehicleType, getSiteVehicleTypes } from "@/lib/vehicle-context";
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
  getVehicleList,
  getSoldVehicleList,
} from "@/lib/queries";
import { existingMedia, getHeroMedia } from "@/lib/hero-media";
import { OPTIONAL_MEDIA } from "@/lib/media";
import { bodiesFor } from "@/lib/vehicle-categories";
import { brandOptions, sameBrand } from "@/lib/brand-name";

// O canónico da página inicial (sem query strings) e o seu `og:url`. O título
// e a descrição vêm da layout raiz.
export function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, { path: "/" });
}

// ISR: revalida a cada 60s — novos destaques e edições de conteúdo aparecem
// sem rebuild manual.
export const revalidate = 60;

// Server Component: os dados (destaques + conteúdo editável) são obtidos no
// servidor e passados às ilhas cliente. Zero JS de dados enviado para o browser.
export default async function HomePage() {
  // Um só site: carros e motas juntos. O tipo principal (carros, salvo num
  // site só de motas) dá o topo, as fotos e os textos.
  const [type, siteTypes] = await Promise.all([getPublicVehicleType(), getSiteVehicleTypes()]);
  const [showroom, content, testimonials, branding, allVehicles, sold] =
    await Promise.all([
      getShowroomContent(),
      getHomeContent(),
      getTestimonials(),
      getBranding(),
      getVehicleList(),
      getSoldVehicleList(10),
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
  const segments = siteTypes
    .flatMap((t) => bodiesFor(t))
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

  // O topo (imagem e textos) é o dos carros ou o das motas: escolhe-se no
  // backoffice (Página inicial → Destaque); «Automático» segue o tipo
  // principal. Só um tipo que o site venda.
  const heroType =
    content.heroType !== "auto" && siteTypes.includes(content.heroType) ? content.heroType : type;
  // A definição do backoffice (vídeo/imagem) é a dos carros; as motas detetam pelo ficheiro.
  const heroMedia: HeroMedia = getHeroMedia(heroType === "motorcycle" ? "auto" : content.hero.media, heroType);
  // As motas têm o seu próprio topo, editável no backoffice (Página inicial).
  const heroContent = heroType === "motorcycle" ? { ...content.hero, ...content.motoHero } : content.hero;

  return (
    <>
      <Hero
        content={heroContent}
        media={heroMedia}
        // Na foto dos carros o carro está no terço de baixo: no telemóvel
        // sobe para o espaço entre o título e a pesquisa.
        raiseMediaOnMobile={heroType === "car"}
        search={
          allVehicles.length > 0 ? <QuickSearch vehicles={searchItems} /> : null
        }
      />

      {/* Opcional: Página inicial → Secções (por defeito escondida). */}
      {content.showSegments && <Segments segments={segments} />}
      {/* A lista vem com as marcadas como destaque primeiro, depois as mais
          recentes. */}
      <FeaturedVehicles vehicles={allVehicles} total={allVehicles.length} />
      <BrandMarquee
        brands={marqueeBrands}
        available={stockBrands}
      />
      <HomeStock vehicles={allVehicles} />
      {/* Num site com carros e motas, «Tem uma viatura para trocar?». */}
      <SellCTA vehicleType={type} mixed={siteTypes.length > 1} />
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
