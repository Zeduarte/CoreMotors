import type { Vehicle } from "@/types/vehicle";
import { site } from "@/lib/site";
import { safeJsonLd } from "@/lib/json-ld";

/**
 * JSON-LD do tipo schema.org/Vehicle para rich results de SEO.
 *
 * Renderizado no servidor dentro da página estática, por isso os motores de
 * busca recebem-no no HTML inicial. Mapeamos os campos do domínio para as
 * propriedades canónicas do schema (fuelType, mileageFromOdometer, offers…).
 */
export function VehicleJsonLd({
  vehicle,
  sellerName = site.name,
}: {
  vehicle: Vehicle;
  sellerName?: string;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Vehicle",
    name: `${vehicle.make} ${vehicle.model} ${vehicle.year}`,
    brand: { "@type": "Brand", name: vehicle.make },
    model: vehicle.model,
    vehicleModelDate: String(vehicle.year),
    dateVehicleFirstRegistered: vehicle.registrationMonth
      ? `${vehicle.year}-${String(vehicle.registrationMonth).padStart(2, "0")}`
      : String(vehicle.year),
    description: vehicle.description,
    image: vehicle.images.map((i) => i.src),
    bodyType: vehicle.body,
    color: vehicle.color,
    numberOfDoors: vehicle.doors,
    vehicleSeatingCapacity: vehicle.seats,
    fuelType: vehicle.fuel,
    vehicleTransmission: vehicle.transmission,
    vehicleEngine: {
      "@type": "EngineSpecification",
      enginePower: {
        "@type": "QuantitativeValue",
        value: vehicle.power,
        unitText: "cv",
      },
      ...(vehicle.displacement > 0 && {
        engineDisplacement: {
          "@type": "QuantitativeValue",
          value: vehicle.displacement,
          unitCode: "CMQ",
        },
      }),
    },
    mileageFromOdometer: {
      "@type": "QuantitativeValue",
      value: vehicle.mileage,
      unitCode: "KMT",
    },
    offers: {
      "@type": "Offer",
      priceCurrency: "EUR",
      price: vehicle.price,
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/UsedCondition",
      seller: { "@type": "AutoDealer", name: sellerName, url: site.url },
    },
  };

  return (
    <script
      type="application/ld+json"
      // `safeJsonLd` escapa `<`, `>`, `&` e U+2028/9: a descrição vem do backoffice.
      dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
    />
  );
}
