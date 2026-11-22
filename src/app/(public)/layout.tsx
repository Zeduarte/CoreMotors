import { getPublicVehicleType, getSiteVehicleTypes } from "@/lib/vehicle-context";
import { VehicleWorld } from "@/components/site/VehicleWorld";
import { LenisProvider } from "@/components/providers/LenisProvider";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Suspense } from "react";
import { ScrollProgress } from "@/components/ui/ScrollProgress";
import { NavigationProgress } from "@/components/ui/NavigationProgress";
import { NavigationEvents } from "@/components/ui/NavigationEvents";
import { GrainOverlay } from "@/components/ui/GrainOverlay";
import { ChatLauncher } from "@/components/chat/ChatLauncher";
import { ChatProvider } from "@/components/chat/ChatContext";
import { CompareProvider } from "@/components/inventory/CompareContext";
import { CompareBar } from "@/components/inventory/CompareBar";
import { DealerJsonLd } from "@/components/seo/DealerJsonLd";
import { getBadges, getBranding, getSoldVehicleList, getVehicleList } from "@/lib/queries";
import { BadgesProvider } from "@/components/site/BadgesContext";
import { existingMedia } from "@/lib/hero-media";
import { OPTIONAL_MEDIA } from "@/lib/media";
import { SiteIntro } from "@/components/site/SiteIntro";
import { vehiclesLabel } from "@/lib/site-types";
import { getSiteTheme } from "@/lib/site-theme-query";
import { SiteThemeProvider } from "@/components/site/SiteTheme";
import { Core2Header } from "@/components/themes/core2/Core2Header";
import { Core2Footer } from "@/components/themes/core2/Core2Footer";
import { core2Serif } from "@/themes/core2/fonts";
import { navLinks } from "@/themes/core2/ui";
import { kindOf } from "@/themes/core2/stock";
import { getShowroomContent } from "@/lib/showroom-queries";
// O CSS de cada tema (sempre debaixo de [data-site-theme="…"]).
import "@/themes/core2.css";

/**
 * Chrome do site PÚBLICO: smooth scroll (Lenis), barra de progresso, grão,
 * header e footer de marketing. A marca (nome/logo) vem da BD (editável pelo
 * admin). O backoffice (`/admin`) não passa por aqui — tem a sua própria layout.
 */
export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Um só site: carros e motas juntos (os tipos de Definições → Tipo de site).
  // O tipo principal dá o aspeto (fotos e textos) — o dos carros, salvo num
  // site só de motas.
  const [branding, type, siteTypes, badges, stock, sold, theme, showroom] = await Promise.all([
    getBranding(),
    getPublicVehicleType(),
    getSiteVehicleTypes(),
    getBadges(),
    // Para os contadores do browser (favoritos e comparação) contarem só o
    // que o site mostra. Leituras em cache (as mesmas das páginas).
    getVehicleList(),
    getSoldVehicleList(),
    // A versão do site (Gestão): Core ou Core2.
    getSiteTheme(),
    // O nome do ponto de venda principal (rodapé do Core2, no telemóvel).
    getShowroomContent(),
  ]);
  // Core2 (as maquetes): menu, rodapé e letra próprios, fundo claro.
  const core2 = theme === "core2";
  // Sem stock nenhum (ou a leitura falhou), não se filtra nada: um erro
  // passageiro não pode apagar a comparação de quem está a navegar.
  const stockSlugs = stock.length ? stock.map((v) => v.slug) : undefined;
  // Hora do render, para a etiqueta «Novidade» igual no servidor e no browser.
  const renderedAt = Date.now();

  return (
    <SiteThemeProvider theme={theme}><VehicleWorld type={type} types={siteTypes}><BadgesProvider badges={badges} now={renderedAt}><LenisProvider>
      {/* O provider envolve o conteúdo: a barra fixa da ficha de viatura
          precisa de abrir o mesmo painel de conversa que o botão flutuante. */}
      <ChatProvider enabled={!!process.env.ANTHROPIC_API_KEY}>
      <CompareProvider available={stockSlugs && [...stockSlugs, ...sold.map((v) => v.slug)]}>
      {/* `.site`: estilos só do site público (ex.: botões); `contents` não
          cria caixa, por isso não altera o layout. */}
      {/* `data-site-theme`: o CSS de cada tema (src/themes/<tema>.css). */}
      <div className={`site contents${core2 ? ` ${core2Serif.variable}` : ""}`} data-site-theme={theme}>
        {/* Entrada da 1.ª visita: a foto das motas enquanto o site carrega. */}
        <SiteIntro name={branding.companyName} label={vehiclesLabel(siteTypes)} />
        {/* Salto para conteúdo — acessibilidade por teclado. */}
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
        >
          Saltar para o conteúdo
        </a>
        <DealerJsonLd branding={branding} siteTypes={siteTypes} />
        <ScrollProgress />
        {/* `useSearchParams` exige um Suspense para não desligar o render estático. */}
        <Suspense fallback={null}>
          <NavigationEvents />
          <NavigationProgress />
        </Suspense>
        {core2 ? (
          <Core2Header branding={branding} links={navLinks(siteTypes, stock.some((v) => kindOf(v) === "moto4"))} />
        ) : (
          <Header branding={branding} stockSlugs={stockSlugs} />
        )}
        <main id="conteudo" className="pt-16">{children}</main>
        {core2 ? (
          <Core2Footer branding={branding} placeName={showroom.locations[0]?.name} />
        ) : (
          <Footer branding={branding} background={existingMedia(type, OPTIONAL_MEDIA.rodape)} siteTypes={siteTypes} />
        )}
        {/* Assistente virtual + canais de contacto no mesmo botão flutuante.
            Na ficha de viatura o botão dá lugar à barra fixa do fundo.
            Sem chave da Anthropic configurada, fica só o contacto humano. */}
        <ChatLauncher
          whatsapp={branding.company.whatsapp}
          messenger={branding.company.messenger}
          name={branding.companyName}
          chatEnabled={!!process.env.ANTHROPIC_API_KEY}
        />
        <CompareBar />
        {/* O grão é para o fundo escuro do Core. */}
        {!core2 && <GrainOverlay />}
      </div>
      </CompareProvider>
      </ChatProvider>
    </LenisProvider></BadgesProvider></VehicleWorld></SiteThemeProvider>
  );
}
