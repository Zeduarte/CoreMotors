import type {
  CarRow,
  CarMediaRow,
  CarWithMedia,
} from "@/lib/supabase/database.types";
import { publicMediaUrl } from "@/lib/storage";
import { formatKm } from "@/lib/format";
import type { Vehicle, VehicleImage, VehicleSpec } from "@/types/vehicle";

const PLACEHOLDER: VehicleImage = {
  src: "/placeholder-car.svg",
  alt: "Fotografia por publicar",
  width: 1600,
  height: 1067,
};

/** Ordena e separa media: imagens (capa primeiro) vs. primeiro vídeo. */
function splitMedia(media: CarMediaRow[]) {
  const sorted = [...media].sort(
    (a, b) =>
      Number(b.is_cover) - Number(a.is_cover) || a.position - b.position,
  );
  const images = sorted
    .filter((m) => m.kind === "image")
    .map<VehicleImage>((m) => ({
      src: publicMediaUrl(m.storage_path),
      alt: m.alt || "Fotografia da viatura",
      width: m.width ?? 1600,
      height: m.height ?? 1067,
    }));
  const videoRow = sorted.find((m) => m.kind === "video");
  const video = videoRow
    ? {
        src: publicMediaUrl(videoRow.storage_path),
        type: videoRow.storage_path.endsWith(".webm")
          ? "video/webm"
          : "video/mp4",
      }
    : null;
  return { images: images.length ? images : [PLACEHOLDER], video };
}

/**
 * Deriva os "highlights" apresentados na ficha. Se o carro tiver highlights
 * personalizados guardados, usa-os; caso contrário constrói a partir dos specs
 * estruturados — garantindo uma grelha coerente e sempre correta.
 */
function deriveHighlights(car: CarRow): VehicleSpec[] {
  if (Array.isArray(car.highlights) && car.highlights.length > 0) {
    return car.highlights as VehicleSpec[];
  }
  const specs: VehicleSpec[] = [
    { label: "Ano", value: String(car.year) },
    { label: "Quilómetros", value: formatKm(car.mileage) },
    { label: "Combustível", value: car.fuel ?? "Por confirmar" },
    { label: "Caixa", value: car.transmission ?? "Por confirmar" },
  ];
  if (car.power > 0)
    specs.splice(2, 0, { label: "Potência", value: `${car.power} cv` });
  return specs.slice(0, 5);
}

/** Imagem de capa de um carro (para listas do backoffice). */
export function coverImage(car: CarWithMedia): {
  src: string;
  alt: string;
} {
  const media = car.car_media ?? [];
  const cover =
    media.find((m) => m.is_cover && m.kind === "image") ??
    [...media]
      .filter((m) => m.kind === "image")
      .sort((a, b) => a.position - b.position)[0];
  return cover
    ? { src: publicMediaUrl(cover.storage_path), alt: cover.alt || "Viatura" }
    : { src: PLACEHOLDER.src, alt: PLACEHOLDER.alt };
}

/** Converte uma linha `cars` (+ media) no tipo de domínio `Vehicle`. */
export function toVehicle(car: CarWithMedia): Vehicle {
  const { images, video } = splitMedia(car.car_media ?? []);
  return {
    id: car.id,
    slug: car.slug,
    make: car.make,
    model: car.model,
    variant: car.variant ?? undefined,
    year: car.year!,
    registrationMonth: car.registration_month,
    vehicleType: car.vehicle_type ?? "car",
    pointOfSaleId: car.point_of_sale_id,
    price: car.price ?? 0,
    priceOnRequest: car.price_on_request,
    mileage: car.mileage,
    fuel: car.fuel!,
    transmission: car.transmission!,
    body: car.body!,
    power: car.power,
    displacement: car.displacement,
    color: car.color ?? "",
    doors: car.doors,
    seats: car.seats,
    featured: car.featured,
    status: car.status,
    extras: car.extras ?? [],
    location: car.location ?? undefined,
    tagline: car.tagline ?? "",
    description: car.description ?? "",
    images,
    video,
    highlights: deriveHighlights(car),
    updatedAt: car.updated_at,
    createdAt: car.created_at,
    previousPrice: car.previous_price,
    national: car.national,
    customBadges: car.badges ?? [],
    owners: car.owners,
    firstOwner: car.first_owner,
    serviceBook: car.service_book,
    warrantyMonths: car.warranty_months,
    lastInspection: car.last_inspection,
    olxAttributes: (car.olx_attributes as Record<string, unknown> | null) ?? {},
  };
}
