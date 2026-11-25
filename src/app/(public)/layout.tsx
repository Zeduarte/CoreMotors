import { getPublicVehicleType, getSiteVehicleTypes } from "@/lib/vehicle-context";
import { VehicleWorld } from "@/components/site/VehicleWorld";
import { LenisProvider } from "@/components/providers/LenisProvider";
import { Header } from "@/components/layout/Header";
import { core3Nav } from "@/themes/core3/ui";
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
import { getBadges, getBranding, getLegal, getSocialLinks, getSoldVehicleList, getVehicleList } from "@/lib/queries";
import { BadgesProvider } from "@/components/site/BadgesContext";
import { existingMedia } from "@/lib/hero-media";
import { OPTIONAL_MEDIA } from "@/lib/media";
import { SiteIntro } from "@/components/site/SiteIntro";
import { vehiclesLabel } from "@/lib/site-types";
import { getSiteAppearance } from "@/lib/site-theme-query";
import { SiteThemeProvider } from "@/components/site/SiteTheme";
// O CSS de cada tema (sempre debaixo de [data-site-theme="…"]) e o da
// aparência (Escuro / Claro / Automático, em [data-site-mode="…"]).
import "@/themes/core2.css";
import "@/themes/modes.css";

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
  const [branding, type, siteTypes, badges, stock, sold, appearance, legal, social] = await Promise.all([
    getBranding(),
    getPublicVehicleType(),
    getSiteVehicleTypes(),
    getBadges(),
    // Para os contadores do browser (favoritos e comparação) contarem só o
    // que o site mostra. Leituras em cache (as mesmas das páginas).
    getVehicleList(),
    getSoldVehicleList(),
    // A versão do site (Gestão): Core ou Core2, e a aparência dela.
    getSiteAppearance(),
    getLegal(),
    // Facebook e Instagram do rodapé (Definições → Contactos).
    getSocialLinks(),
  ]);
  const { theme, mode } = appearance;
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
      {/* `data-site-theme`: o CSS de cada tema (src/themes/<tema>.css);
          `data-site-mode`: escuro, claro ou o do sistema (src/themes/modes.css). */}
      <div className="site contents" data-site-theme={theme} data-site-mode={mode}>
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
        {/* O cabeçalho é o do Core em todas as versões; o Core3 tem o seu menu. */}
        <Header branding={branding} stockSlugs={stockSlugs} nav={theme === "core3" ? core3Nav(siteTypes) : undefined} />
        <main id="conteudo" className="pt-16">{children}</main>
        <Footer theme={theme} branding={branding} legal={legal} background={existingMedia(type, OPTIONAL_MEDIA.rodape)} siteTypes={siteTypes} social={social} />
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
        <GrainOverlay />
      </div>
      </CompareProvider>
      </ChatProvider>
    </LenisProvider></BadgesProvider></VehicleWorld></SiteThemeProvider>
  );
}
