import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { getBranding, getSiteVehicleTypes } from "@/lib/queries";
import { siteDescription, vehiclesLabel } from "@/lib/site-types";

// Muda pouco: o nome é o das Definições e diz o que o stand vende (Tipo de site).
export const revalidate = 3600;

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
export async function GET() {
  const [types, branding] = await Promise.all([getSiteVehicleTypes(), getBranding()]);
  // O nome da empresa nas Definições, como no título das páginas.
  const name = branding.companyName || site.name;
  const manifest: MetadataRoute.Manifest = {
    name: `${name} — ${vehiclesLabel(types)}`,
    short_name: name,
    description: siteDescription(types),
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
      // PNG para quem não aceita SVG (o iOS e alguns Android).
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
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
