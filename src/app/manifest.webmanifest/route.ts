import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

// Gerado no build, como os ficheiros estáticos.
export const dynamic = "force-static";

/**
 * Web App Manifest (PWA). Permite "Adicionar ao ecrã inicial" no telemóvel,
 * com ícone, nome e cores próprias. Servido em `/manifest.webmanifest`.
 *
 * É uma rota normal (e não `app/manifest.ts`) de propósito: o manifest "de
 * ficheiro" do Next é colado também a cada segmento de 1.º nível e passa à
 * frente do `manifest` dos layouts — o backoffice ficava com o do site em vez
 * do seu (`/admin/manifest.webmanifest`). O `<link rel="manifest">` vem do
 * `metadata` do layout raiz, que o de `/admin` substitui.
 */
export function GET() {
  const manifest: MetadataRoute.Manifest = {
    name: `${site.name} — Motas e Automóveis`,
    short_name: site.name,
    description: site.description,
    start_url: "/",
    display: "standalone",
    background_color: "#0A0A0A",
    theme_color: "#0A0A0A",
    lang: "pt-PT",
    categories: ["shopping", "business"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
