import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getVehicles } from "@/lib/queries";
import { formatKm, priceLabel } from "@/lib/format";
import type { Vehicle } from "@/types/vehicle";
import { CAR_BODIES, MOTORCYCLE_BODIES } from "@/lib/vehicle-categories";

/**
 * Ferramenta de pesquisa de stock do assistente virtual.
 *
 * O modelo pede filtros; o servidor executa-os contra o inventário público
 * (`getVehicles` já respeita a RLS — só devolve viaturas publicadas ou
 * reservadas). O modelo nunca toca na base de dados nem escolhe SQL.
 */

export const SEARCH_TOOL_NAME = "pesquisar_viaturas";

const FUELS = [
  "Gasolina",
  "Diesel",
  "Híbrido",
  "Híbrido Plug-in",
  "Elétrico",
  "GPL",
] as const;

// Carroçarias dos carros e categorias das motas (o site tem os dois).
const BODIES = [...CAR_BODIES, ...MOTORCYCLE_BODIES] as const;

/** Valida o input do modelo antes de correr a pesquisa. */
export const SearchInput = z.object({
  tipo: z.enum(["carro", "mota"]).optional(),
  marca: z.string().max(60).optional(),
  modelo: z.string().max(60).optional(),
  texto: z.string().max(120).optional(),
  preco_min: z.number().nonnegative().max(10_000_000).optional(),
  preco_max: z.number().nonnegative().max(10_000_000).optional(),
  ano_min: z.number().int().min(1900).max(2100).optional(),
  km_max: z.number().nonnegative().max(2_000_000).optional(),
  combustivel: z.enum(FUELS).optional(),
  transmissao: z.enum(["Manual", "Automática"]).optional(),
  carrocaria: z.enum(BODIES).optional(),
  lugares_min: z.number().int().min(1).max(9).optional(),
});

export type SearchInput = z.infer<typeof SearchInput>;

export const SEARCH_TOOL: Anthropic.Tool = {
  name: SEARCH_TOOL_NAME,
  description:
    "Pesquisa as viaturas disponíveis no stand. Usa-a sempre que a pergunta " +
    "envolva viaturas que não a da página aberta, orçamentos, comparações ou " +
    "disponibilidade. Todos os filtros são opcionais — sem filtros devolve as " +
    "viaturas mais recentes. Devolve no máximo 6 resultados e o total encontrado.",
  input_schema: {
    type: "object",
    properties: {
      tipo: {
        type: "string",
        enum: ["carro", "mota"],
        description: "Carro ou mota. Use sempre que o cliente disser o que procura.",
      },
      marca: { type: "string", description: "Marca, ex.: BMW, Renault, Yamaha." },
      modelo: { type: "string", description: "Modelo, ex.: Clio, Série 1." },
      texto: {
        type: "string",
        description: "Pesquisa livre em marca, modelo, versão e descrição.",
      },
      preco_min: { type: "number", description: "Preço mínimo em euros." },
      preco_max: { type: "number", description: "Preço máximo em euros." },
      ano_min: { type: "number", description: "Ano mínimo de matrícula." },
      km_max: { type: "number", description: "Quilometragem máxima." },
      combustivel: { type: "string", enum: [...FUELS] },
      transmissao: { type: "string", enum: ["Manual", "Automática"] },
      carrocaria: {
        type: "string",
        enum: [...BODIES],
        description: "Carroçaria (carros) ou categoria (motas: Scooter, Naked, Trail…).",
      },
      lugares_min: { type: "number", description: "Número mínimo de lugares." },
    },
    required: [],
  },
};

const MAX_RESULTS = 6;

export interface SearchOutcome {
  /** Texto devolvido ao modelo como `tool_result`. */
  content: string;
  /** slug → nome legível, para validar os links que o modelo sugerir. */
  slugs: Map<string, string>;
}

/** Executa a pesquisa e devolve-a em texto compacto (menos tokens que JSON). */
export async function runSearch(input: SearchInput): Promise<SearchOutcome> {
  const all = await getVehicles();
  const needle = input.texto?.toLowerCase().trim();

  const matches = all.filter((v) => {
    if (input.tipo && (v.vehicleType ?? "car") !== (input.tipo === "mota" ? "motorcycle" : "car")) return false;
    if (input.marca && !eq(v.make, input.marca)) return false;
    if (input.modelo && !contains(v.model, input.modelo)) return false;
    if (input.combustivel && v.fuel !== input.combustivel) return false;
    if (input.transmissao && v.transmission !== input.transmissao) return false;
    if (input.carrocaria && v.body !== input.carrocaria) return false;
    if (input.ano_min != null && v.year < input.ano_min) return false;
    if (input.km_max != null && v.mileage > input.km_max) return false;
    if (input.lugares_min != null && v.seats < input.lugares_min) return false;
    // Viaturas sob consulta não têm preço comparável — ficam fora de um
    // filtro de preço em vez de aparecerem como se custassem 0 €.
    if (input.preco_min != null || input.preco_max != null) {
      if (v.priceOnRequest || !v.price) return false;
      if (input.preco_min != null && v.price < input.preco_min) return false;
      if (input.preco_max != null && v.price > input.preco_max) return false;
    }
    if (needle) {
      const hay =
        `${v.make} ${v.model} ${v.variant ?? ""} ${v.tagline} ${v.description}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const slugs = new Map<string, string>();
  if (matches.length === 0) {
    return {
      content:
        "Nenhuma viatura corresponde a esses critérios. Sugere alargar a " +
        "pesquisa ou encaminha para a equipa.",
      slugs,
    };
  }

  const shown = matches.slice(0, MAX_RESULTS);
  for (const v of shown) slugs.set(v.slug, `${v.make} ${v.model}`);

  const header =
    matches.length > shown.length
      ? `${matches.length} viaturas encontradas; seguem as ${shown.length} primeiras.`
      : `${matches.length} viatura(s) encontrada(s).`;

  return { content: [header, "", ...shown.map(line)].join("\n"), slugs };
}

function line(v: Vehicle): string {
  const bits = [
    v.vehicleType === "motorcycle" ? "MOTA" : "CARRO",
    `${v.make} ${v.model}${v.variant ? ` ${v.variant}` : ""}`,
    v.body,
    String(v.year),
    formatKm(v.mileage),
    v.fuel,
    v.transmission,
    priceLabel(v.price, v.priceOnRequest),
  ];
  if (v.warrantyMonths) bits.push(`garantia ${v.warrantyMonths} meses`);
  if (v.status === "reserved") bits.push("RESERVADA");
  return `- ${bits.join(" · ")} [slug: ${v.slug}]`;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const eq = (a: string, b: string) => norm(a) === norm(b);
const contains = (a: string, b: string) => norm(a).includes(norm(b));
