export const MOTORCYCLE_BODIES = [
  "Scooter",
  "Naked",
  "Desportiva",
  "Trail",
  "Touring",
  "Chopper/Cruiser",
  "Enduro",
  "Moto 4",
] as const;
export const CAR_BODIES = [
  "Berlina",
  "SUV",
  "Coupé",
  "Carrinha",
  "Citadino",
  "Utilitário",
  "Descapotável",
  "Monovolume",
] as const;
/** Combustíveis que se oferecem para uma mota (como na encomenda do site). */
export const MOTORCYCLE_FUELS = ["Gasolina", "Elétrico"] as const;
export const VEHICLE_TYPES = ["car", "motorcycle"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/**
 * Uma frase por categoria, para escolher como no OLX: um quadrado por
 * categoria, com o nome e o que a distingue — sem ter de saber os termos.
 */
export const BODY_HINT: Record<string, string> = {
  Scooter: "Automática, para a cidade",
  Naked: "Sem carenagem, versátil",
  Desportiva: "Carenagem, alto desempenho",
  Trail: "Estrada e terra, viagens",
  Touring: "Conforto para viagens longas",
  "Chopper/Cruiser": "Posição relaxada, estilo custom",
  Enduro: "Todo-o-terreno",
  "Moto 4": "Quads e ATV",
  Berlina: "Sedan, mala separada",
  SUV: "Posição alta, versátil",
  Coupé: "Duas portas, desportivo",
  Carrinha: "Mala grande, familiar",
  Citadino: "Pequeno, para a cidade",
  Utilitário: "Compacto, do dia a dia",
  Descapotável: "Capota amovível",
  Monovolume: "Espaço e muitos lugares",
};

/** As categorias de cada tipo de viatura, pela ordem em que se mostram. */
export function bodiesFor(type: VehicleType | null | undefined): readonly string[] {
  return type === "motorcycle" ? MOTORCYCLE_BODIES : CAR_BODIES;
}
export function isMotorcycleBody(body: string): boolean {
  return (MOTORCYCLE_BODIES as readonly string[]).includes(body);
}
export function registrationLabel(year: number, month?: number | null): string {
  return month ? `${String(month).padStart(2, "0")}/${year}` : String(year);
}
export function isCampaign(vehicle: {
  price: number;
  priceOnRequest?: boolean;
  previousPrice?: number | null;
}): boolean {
  return (
    !vehicle.priceOnRequest &&
    vehicle.price > 0 &&
    (vehicle.previousPrice ?? 0) > vehicle.price
  );
}

// Sugestões; o editor também aceita marcas e modelos escritos livremente.
export const MOTORCYCLE_BRANDS = [
  "Aprilia",
  "Benelli",
  "BMW",
  "CFMoto",
  "Ducati",
  "Harley-Davidson",
  "Honda",
  "Husqvarna",
  "Kawasaki",
  "KTM",
  "Kymco",
  "Moto Guzzi",
  "Piaggio",
  "Royal Enfield",
  "Suzuki",
  "SYM",
  "Triumph",
  "Vespa",
  "Yamaha",
  "Zero",
] as const;
export function inventoryVehicleType(
  value: string | string[] | undefined,
): VehicleType | null {
  return value === "carros" ? "car" : value === "motas" ? "motorcycle" : null;
}

/**
 * Uma viatura está na Oficina ou em Viaturas, nunca nas duas. Na Oficina só as
 * que estão em trabalho; rascunho, preparada, publicada, reservada e vendida
 * aparecem em Viaturas.
 */
export function showsInWorkshop(status: string): boolean {
  return status === "workshop";
}
