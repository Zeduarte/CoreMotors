import { ImageResponse } from "next/og";
import { getBranding } from "@/lib/queries";
import { site } from "@/lib/site";

export const alt = "Motas e automóveis";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Muda pouco (nome, frase e cor da marca): uma hora chega.
export const revalidate = 3600;

/**
 * Imagem Open Graph por defeito do site público — o que aparece ao partilhar
 * a página inicial, o stock, as listas por marca ou as páginas institucionais.
 * As fichas de viatura têm a sua (`viaturas/[slug]/opengraph-image.tsx`).
 */
export default async function Image() {
  const branding = await getBranding();
  const accent = branding.accent || "#E8B15A";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0A0A0A",
          backgroundImage:
            "radial-gradient(1200px 600px at 80% -10%, rgba(232,177,90,0.18), transparent)",
          padding: "72px 80px",
          color: "#F5F5F4",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", width: 96, height: 8, background: accent, borderRadius: 4 }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>
            {branding.companyName}
          </div>
          <div style={{ display: "flex", fontSize: 36, color: "rgba(245,245,244,0.7)", marginTop: 24, maxWidth: 960 }}>
            {branding.tagline || "Motas e automóveis em Portugal"}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: accent }}>
          {site.url.replace(/^https?:\/\//, "")}
        </div>
      </div>
    ),
    size,
  );
}
