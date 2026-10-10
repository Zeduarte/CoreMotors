import { getPublicVehicleType, getVehicleSelection } from "@/lib/vehicle-context";
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
import { getBadges, getBranding } from "@/lib/queries";
import { BadgesProvider } from "@/components/site/BadgesContext";
import { WorldEntrance } from "@/components/site/WorldEntrance";
import { WorldArrival } from "@/components/site/WorldArrival";
import { existingMedia } from "@/lib/hero-media";
import { OPTIONAL_MEDIA } from "@/lib/media";

/**
 * Chrome do site PÚBLICO: smooth scroll (Lenis), barra de progresso, grão,
 * header e footer de marketing. A marca (nome/logo) vem da BD (editável pelo
 * admin). O backoffice (`/admin`) não passa por aqui — tem a sua própria layout.
 */
export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [branding, type, selection, badges] = await Promise.all([
    getBranding(),
    getPublicVehicleType(),
    getVehicleSelection(),
    getBadges(),
  ]);

  return (
    <VehicleWorld key={type} type={type}><BadgesProvider badges={badges}><LenisProvider>
      {/* O provider envolve o conteúdo: a barra fixa da ficha de viatura
          precisa de abrir o mesmo painel de conversa que o botão flutuante. */}
      <ChatProvider enabled={!!process.env.ANTHROPIC_API_KEY}>
      <CompareProvider>
      {/* `.site`: estilos só do site público (ex.: botões); `contents` não
          cria caixa, por isso não altera o layout. */}
      <div className="site contents">
        <WorldEntrance name={branding.companyName} selected={selection} />
        {/* Troca de mundo: a página abre tapada pela foto e revela-se. */}
        <WorldArrival type={type} />
        {/* Salto para conteúdo — acessibilidade por teclado. */}
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
        >
          Saltar para o conteúdo
        </a>
        <DealerJsonLd branding={branding} />
        <ScrollProgress />
        {/* `useSearchParams` exige um Suspense para não desligar o render estático. */}
        <Suspense fallback={null}>
          <NavigationEvents />
          <NavigationProgress />
        </Suspense>
        <Header branding={branding} />
        <main id="conteudo" className="pt-16">{children}</main>
        <Footer branding={branding} background={existingMedia(type, OPTIONAL_MEDIA.rodape)} />
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
    </LenisProvider></BadgesProvider></VehicleWorld>
  );
}
