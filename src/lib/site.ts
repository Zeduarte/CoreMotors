import { normalizeWhatsApp } from "./phone";

/** Constantes de marca e contactos — um único sítio para editar. */

export const site = {
  name: "CoreMotors",
  legalName: "Supermotas — Motas e Automóveis",
  description:
    "Stand de motas e automóveis em Portugal. Viaturas selecionadas, histórico transparente e uma experiência de compra sem fricção.",
  // O domínio de cada stand vem do Netlify (NEXT_PUBLIC_SITE_URL, fixado no
  // build). O valor fixo é só o último recurso: canónicos, sitemap e links de
  // partilha apontavam para ele mesmo com o domínio próprio já ligado.
  url: process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") || "https://supermotas.netlify.app",
  phone: "+351 210 000 000",
  phoneHref: "tel:+351210000000",
  whatsapp: "351910000000",
  email: "geral@supermotas.pt",
  address: {
    street: "Av. da Liberdade 100",
    city: "Lisboa",
    postalCode: "1250-096",
    country: "Portugal",
  },
  // Coordenadas usadas no mapa (Av. da Liberdade, Lisboa).
  geo: { lat: 38.7223, lng: -9.1447 },
  hours: "Seg–Sáb · 09h00–19h00",
  accent: "#E8B15A",
} as const;

export function whatsappHref(message: string): string {
  return `https://wa.me/${normalizeWhatsApp(site.whatsapp)}?text=${encodeURIComponent(message)}`;
}
