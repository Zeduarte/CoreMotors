/**
 * Modelo de domínio de uma viatura.
 *
 * Este ficheiro é a "fonte da verdade" de tipos do domínio público. O mapper
 * `src/lib/mappers.ts` converte as linhas do Supabase (`cars` + `car_media`)
 * neste tipo, de forma a que os componentes não conheçam o formato da BD.
 */

export type FuelType =
  | "Gasolina"
  | "Diesel"
  | "Híbrido"
  | "Híbrido Plug-in"
  | "Elétrico"
  | "GPL";

export type Transmission = "Manual" | "Automática";

export type BodyType =
  | "Berlina"
  | "SUV"
  | "Coupé"
  | "Carrinha"
  | "Citadino"
  | "Utilitário"
  | "Descapotável"
  | "Monovolume"
  | "Scooter"
  | "Naked"
  | "Desportiva"
  | "Trail"
  | "Touring"
  | "Chopper/Cruiser"
  | "Enduro"
  | "Moto 4";

export type VehicleStatus = "workshop" | "draft" | "prepared" | "published" | "reserved" | "sold";

export interface VehicleVideo {
  src: string;
  /** mp4 | webm — usado no `type` do <source>. */
  type: string;
}

export interface VehicleImage {
  /** URL absoluta ou caminho em /public. */
  src: string;
  /** Alt text obrigatório para acessibilidade. */
  alt: string;
  /** Dimensões conhecidas para evitar layout shift (CLS). */
  width: number;
  height: number;
}

export interface VehicleSpec {
  label: string;
  value: string;
}

export interface Vehicle {
  /** UUID na base de dados (ausente em dados de mock). */
  id?: string;
  /** Identificador estável, usado como chave e em URLs de detalhe. */
  slug: string;
  make: string;
  model: string;
  /** Nível de acabamento / versão, ex. "Competition", "S line". */
  variant?: string;
  year: number;
  registrationMonth?: number | null;
  vehicleType?: "car" | "motorcycle";
  pointOfSaleId?: string | null;
  /** Preço em euros (inteiro, sem casas decimais). */
  price: number;
  mileage: number;
  fuel: FuelType;
  transmission: Transmission;
  body: BodyType;
  /** Potência em cavalos (cv). */
  power: number;
  /** Cilindrada em cm³ (0 para elétricos). */
  displacement: number;
  color: string;
  doors: number;
  seats: number;
  /** Destaque na homepage. */
  featured: boolean;
  /** Estado comercial. As páginas públicas só recebem `published`. */
  status?: VehicleStatus;
  /** `true` quando o preço é "sob consulta" (então `price` é 0). */
  priceOnRequest?: boolean;
  /** Equipamento / extras. */
  extras?: string[];
  /** Stand / localização. */
  location?: string;
  /** Frase curta de marketing. */
  tagline: string;
  description: string;
  /** Primeira imagem = capa; restantes = galeria. */
  images: VehicleImage[];
  /** Vídeo opcional do anúncio (mp4/webm). */
  video?: VehicleVideo | null;
  /** Ficha técnica alargada apresentada na secção pinned e no detalhe. */
  highlights: VehicleSpec[];
  /** ISO da última atualização (para sitemap / ordenação). */
  updatedAt?: string;
  /** ISO da criação (usado para o badge "Novidade"). */
  createdAt?: string;
  /** Preço anterior — se maior que `price`, mostra badge "Baixa de preço". */
  previousPrice?: number | null;
  /** Viatura nacional (badge "Nacional"). */
  national?: boolean;
  /** Etiquetas do stand marcadas na ficha (ids de Definições → Etiquetas). */
  customBadges?: string[];
  /** Transparência: nº de donos, 1º dono, livro de revisões, garantia, inspeção. */
  owners?: number | null;
  firstOwner?: boolean;
  serviceBook?: boolean;
  warrantyMonths?: number | null;
  lastInspection?: string | null;
  /** Campos do OLX escolhidos na ficha (crus, só no servidor). */
  olxAttributes?: Record<string, unknown>;
  /** Valores finais dos campos do OLX pesquisáveis (listas do stock). */
  olx?: Record<string, string | string[]>;
}

/** Payload dos filtros do inventário. */
export interface VehicleFilters {
  /** Pesquisa livre (marca, modelo, versão). */
  query: string | null;
  make: string | null;
  model: string | null;
  fuel: FuelType | null;
  transmission: Transmission | null;
  body: BodyType | null;
  minPrice: number | null;
  maxPrice: number | null;
  minYear: number | null;
  maxMileage: number | null;
  minMileage: number | null;
  maxYear: number | null;
  location: string | null;
  vehicleType: "car" | "motorcycle" | null;
  campaignOnly: boolean;
  /** Potência (cv) e cilindrada (cm³), como no OLX. */
  minPower: number | null;
  maxPower: number | null;
  minDisplacement: number | null;
  maxDisplacement: number | null;
  color: string | null;
  doors: number | null;
  seats: number | null;
  /** Origem nacional, 1.º dono, livro de revisões, com garantia. */
  nationalOnly: boolean;
  firstOwnerOnly: boolean;
  serviceBookOnly: boolean;
  warrantyOnly: boolean;
  /** Campos do OLX: um valor da lista, ou um intervalo para números. */
  olx: Record<string, string | { min: number | null; max: number | null }>;
}

export type SortKey =
  | "relevance"
  | "price-asc"
  | "price-desc"
  | "year-desc"
  | "mileage-asc";
