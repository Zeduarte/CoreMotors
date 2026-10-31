import { site } from "@/lib/site";
import { safeJsonLd } from "@/lib/json-ld";
import { normalizeWhatsApp, type Branding } from "@/lib/branding";
import { parseOpeningHours } from "@/lib/opening-hours";

/**
 * JSON-LD schema.org/AutoDealer — identidade do negócio para o Google
 * (Knowledge Panel, Maps, rich results). Renderizado no layout público, por
 * isso está em todas as páginas. Usa os dados de contacto editáveis no
 * backoffice (morada, telefone, horário, coordenadas).
 */
export function DealerJsonLd({ branding }: { branding: Branding }) {
  const { company, companyName, logoUrl } = branding;

  // "Seg–Sáb · 09h00–12h30 e 14h00–19h00" → um intervalo por dia e horário
  // (a pausa de almoço inclusive). Sem horário reconhecível, sai sem ele.
  const openingHoursSpecification = parseOpeningHours(company.hours);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AutoDealer",
    "@id": `${site.url}/#dealer`,
    name: companyName,
    url: site.url,
    ...(logoUrl && { logo: logoUrl, image: logoUrl }),
    telephone: company.phone,
    email: company.email,
    // Sem `priceRange`: um valor fixo ("€€€") não corresponde ao stock real.
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
    ...(openingHoursSpecification && { openingHoursSpecification }),
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
