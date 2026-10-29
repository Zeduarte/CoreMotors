import { ImageResponse } from "next/og";
import { getVehicleBySlug, getBranding } from "@/lib/queries";
import { formatKm, priceLabel } from "@/lib/format";
import { DEFAULT_BRANDING } from "@/lib/branding";

export const alt = "Viatura";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Gerada no 1.º pedido de cada viatura e guardada um minuto. Não lê o cookie
// carros/motas (ver abaixo), por isso pode ficar guardada.
export const revalidate = 60;

const INK = "#0A0A0A";
const PAPER = "#F5F5F4";

/**
 * Imagem Open Graph gerada dinamicamente por viatura — o que aparece quando
 * alguém partilha o link no WhatsApp, Facebook, etc. Marca, modelo, ano, preço
 * e os KPIs principais sobre um fundo com a cor de acento da marca.
 *
 * Responde SEMPRE com um PNG válido: o desenho é feito aqui (e não em
 * streaming), por isso um erro (dados, tipo de letra, estilo que o gerador não
 * aceite) cai na imagem simples com o nome do stand, em vez de um 500 vazio
 * que deixava a partilha sem imagem.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Sem cookie aqui: quem pede a imagem é o WhatsApp/Facebook, e a viatura
  // procura-se nos dois mundos (`getVehicleBySlug` tenta o outro a seguir).
  const [vehicle, branding] = await Promise.all([
    getVehicleBySlug(slug, "car").catch(() => undefined),
    getBranding().catch(() => DEFAULT_BRANDING),
  ]);
  const name = branding.companyName || DEFAULT_BRANDING.companyName;
  const accent = branding.accent || "#E8B15A";

  const simple = () =>
    new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: INK,
            color: PAPER,
            fontSize: 64,
          }}
        >
          {name}
        </div>
      ),
      size,
    );

  if (!vehicle) return simple();

  try {
    const card = new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            // Cor e gradiente em propriedades separadas: no atalho
            // `background: "radial-gradient(…), #0A0A0A"` o gerador lia a cor
            // como uma 2.ª imagem de fundo e falhava ("Invalid background
            // image") — a imagem saía vazia, com erro 500.
            backgroundColor: INK,
            backgroundImage:
              "radial-gradient(circle at 80% 0%, rgba(232,177,90,0.18), rgba(10,10,10,0) 60%)",
            padding: "72px 80px",
            color: PAPER,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>
              {name}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 24,
                color: INK,
                backgroundColor: accent,
                padding: "8px 22px",
                borderRadius: 999,
                fontWeight: 700,
              }}
            >
              {String(vehicle.year)}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 30, color: "rgba(245,245,244,0.6)", textTransform: "uppercase", letterSpacing: 2 }}>
              {vehicle.make}
            </div>
            <div style={{ display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1.05, marginTop: 6 }}>
              {vehicle.model}
            </div>
            {vehicle.variant ? (
              <div style={{ display: "flex", fontSize: 34, color: "rgba(245,245,244,0.55)", marginTop: 10 }}>
                {vehicle.variant}
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ display: "flex", gap: 40, fontSize: 30, color: "rgba(245,245,244,0.75)" }}>
              <div style={{ display: "flex" }}>{formatKm(vehicle.mileage)}</div>
              {vehicle.fuel ? <div style={{ display: "flex" }}>{vehicle.fuel}</div> : null}
              {vehicle.transmission ? <div style={{ display: "flex" }}>{vehicle.transmission}</div> : null}
            </div>
            <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: accent }}>
              {priceLabel(vehicle.price, vehicle.priceOnRequest)}
            </div>
          </div>
        </div>
      ),
      size,
    );
    // Desenha já (o ImageResponse só desenharia ao enviar, com o 200 já dado).
    const png = await card.arrayBuffer();
    return new Response(png, { headers: card.headers });
  } catch (e) {
    console.error("opengraph-image:", e instanceof Error ? e.message : e);
    return simple();
  }
}
