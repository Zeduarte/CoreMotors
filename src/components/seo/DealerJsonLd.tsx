import { site } from "@/lib/site";
import { safeJsonLd } from "@/lib/json-ld";
import { normalizeWhatsApp, type Branding } from "@/lib/branding";

/**
 * JSON-LD schema.org/AutoDealer — identidade do negócio para o Google
 * (Knowledge Panel, Maps, rich results). Renderizado no layout público, por
 * isso está em todas as páginas. Usa os dados de contacto editáveis no
 * backoffice (morada, telefone, horário, coordenadas).
 */
export function DealerJsonLd({ branding }: { branding: Branding }) {
  const { company, companyName, logoUrl } = branding;

  // "Seg–Sáb · 09h00–19h00" → dias + horas de abertura (best-effort).
  const openingHours = parseHours(company.hours);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AutoDealer",
    "@id": `${site.url}/#dealer`,
    name: companyName,
    url: site.url,
    ...(logoUrl && { logo: logoUrl, image: logoUrl }),
    telephone: company.phone,
    email: company.email,
    priceRange: "€€€",
    address: {
      "@type": "PostalAddress",
      streetAddress: company.address.street,
      addressLocality: company.address.city,
      postalCode: company.address.postalCode,
      addressCountry: company.address.country,
    },
    ...(company.geo.lat && company.geo.lng
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: company.geo.lat,
            longitude: company.geo.lng,
          },
        }
      : {}),
    ...(openingHours && { openingHours }),
    ...(company.whatsapp && {
      sameAs: [`https://wa.me/${normalizeWhatsApp(company.whatsapp)}`],
    }),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
    />
  );
}

/**
 * Converte "Seg–Sáb · 09h00–19h00" no formato schema.org
 * ("Mo-Sa 09:00-19:00"). Devolve null se não reconhecer o padrão.
 */
function parseHours(hours: string): string | null {
  const map: Record<string, string> = {
    seg: "Mo",
    ter: "Tu",
    qua: "We",
    qui: "Th",
    sex: "Fr",
    sáb: "Sa",
    sab: "Sa",
    dom: "Su",
  };
  const dayMatch = hours
    .toLowerCase()
    .match(/(seg|ter|qua|qui|sex|s[áa]b|dom)\s*[–-]\s*(seg|ter|qua|qui|sex|s[áa]b|dom)/);
  const timeMatch = hours.match(/(\d{1,2})h?(\d{2})?\s*[–-]\s*(\d{1,2})h?(\d{2})?/);
  if (!dayMatch || !timeMatch) return null;

  const d1 = map[dayMatch[1]!];
  const d2 = map[dayMatch[2]!];
  const t1 = `${timeMatch[1]!.padStart(2, "0")}:${timeMatch[2] ?? "00"}`;
  const t2 = `${timeMatch[3]!.padStart(2, "0")}:${timeMatch[4] ?? "00"}`;
  if (!d1 || !d2) return null;
  return `${d1}-${d2} ${t1}-${t2}`;
}
