import type { Vehicle } from "@/types/vehicle";
import { site } from "@/lib/site";
import { safeJsonLd } from "@/lib/json-ld";
import { isPlaceholderImage } from "@/lib/mappers";

/** Estado comercial → disponibilidade schema.org da oferta. */
const AVAILABILITY: Record<string, string> = {
  published: "https://schema.org/InStock",
  reserved: "https://schema.org/Reserved",
  sold: "https://schema.org/SoldOut",
};

const absolute = (src: string) => (src.startsWith("/") ? `${site.url}${src}` : src);

/**
 * JSON-LD da viatura (schema.org Car / Motorcycle) para rich results de SEO.
 *
 * Renderizado no servidor dentro da página estática, por isso os motores de
 * busca recebem-no no HTML inicial. Mapeamos os campos do domínio para as
 * propriedades canónicas do schema (fuelType, mileageFromOdometer, offers…).
 *
 * Um zero na ficha é um campo por preencher (ou que não se aplica, como as
 * portas de uma mota): fica de fora, em vez de afirmar "0 portas" ou "0 cv".
 * Preço sob consulta não publica preço — publicar 0 € seria falso. Sem
 * fotografias, sem `image` (o desenho de substituição não é a viatura).
 */
export function buildVehicleJsonLd(
  vehicle: Vehicle,
  sellerName: string = site.name,
  sellerType: "AutoDealer" | "MotorcycleDealer" = "AutoDealer",
) {
  const moto = vehicle.vehicleType === "motorcycle";
  // As moto 4 (quads) não são motociclos; ficam no tipo genérico.
  const type = moto ? (vehicle.body === "Moto 4" ? "Vehicle" : "Motorcycle") : "Car";
  const url = `${site.url}/viaturas/${vehicle.slug}`;
  const hasPrice = !vehicle.priceOnRequest && vehicle.price > 0;
  const description = vehicle.description?.trim();
  const images = vehicle.images.filter((i) => !isPlaceholderImage(i.src)).map((i) => absolute(i.src));

  return {
    "@context": "https://schema.org",
    "@type": type,
    name: `${vehicle.make} ${vehicle.model} ${vehicle.year}`,
    url,
    brand: { "@type": "Brand", name: vehicle.make },
    model: vehicle.model,
    vehicleModelDate: String(vehicle.year),
    dateVehicleFirstRegistered: vehicle.registrationMonth
      ? `${vehicle.year}-${String(vehicle.registrationMonth).padStart(2, "0")}`
      : String(vehicle.year),
    ...(description && { description }),
    ...(images.length > 0 && { image: images }),
    bodyType: vehicle.body,
    ...(vehicle.color && { color: vehicle.color }),
    ...(!moto && vehicle.doors > 0 && { numberOfDoors: vehicle.doors }),
    ...(vehicle.seats > 0 && { vehicleSeatingCapacity: vehicle.seats }),
    fuelType: vehicle.fuel,
    vehicleTransmission: vehicle.transmission,
    ...((vehicle.power > 0 || vehicle.displacement > 0) && {
      vehicleEngine: {
        "@type": "EngineSpecification",
        ...(vehicle.power > 0 && {
          enginePower: {
            "@type": "QuantitativeValue",
            value: vehicle.power,
            unitText: "cv",
          },
        }),
        ...(vehicle.displacement > 0 && {
          engineDisplacement: {
            "@type": "QuantitativeValue",
            value: vehicle.displacement,
            unitCode: "CMQ",
          },
        }),
      },
    }),
    ...(vehicle.mileage > 0 && {
      mileageFromOdometer: {
        "@type": "QuantitativeValue",
        value: vehicle.mileage,
        unitCode: "KMT",
      },
    }),
    offers: {
      "@type": "Offer",
      url,
      ...(hasPrice && { priceCurrency: "EUR", price: vehicle.price }),
      availability: AVAILABILITY[vehicle.status ?? "published"] ?? AVAILABILITY.published,
      itemCondition: "https://schema.org/UsedCondition",
      // O mesmo stand do JSON-LD do layout (DealerJsonLd), pelo `@id`.
      seller: { "@type": sellerType, "@id": `${site.url}/#dealer`, name: sellerName, url: site.url },
    },
  };
}

export function VehicleJsonLd({
  vehicle,
  sellerName = site.name,
  sellerType = "AutoDealer",
}: {
  vehicle: Vehicle;
  sellerName?: string;
  sellerType?: "AutoDealer" | "MotorcycleDealer";
}) {
  return (
    <script
      type="application/ld+json"
      // `safeJsonLd` escapa `<`, `>`, `&` e U+2028/9: a descrição vem do backoffice.
      dangerouslySetInnerHTML={{ __html: safeJsonLd(buildVehicleJsonLd(vehicle, sellerName, sellerType)) }}
    />
  );
}
