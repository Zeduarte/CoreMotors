import { z } from "zod";
import { slugify } from "@/lib/slug";

export const SERVICE_IDS = [
  "financiamento",
  "garantia",
  "oficina",
  "encomendas",
] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];
const text = (max: number) => z.string().trim().max(max);
export const faqSchema = z.object({
  question: text(200).min(1),
  answer: text(2000).min(1),
  category: z.enum(["geral", ...SERVICE_IDS]),
});
export const pointSchema = z
  .object({
    id: text(80).regex(
      /^[a-z0-9-]+$/,
      "Identificador: use letras minúsculas, números e hífen.",
    ),
    name: text(100).min(1),
    address: text(250).min(1),
    city: text(100).min(1),
    postalCode: text(20),
    phone: text(30).regex(/^[+\d\s()-]*$/, "Telefone inválido."),
    email: z.union([z.string().email(), z.literal("")]),
    hours: text(500),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
  })
  .refine((v) => (v.latitude === null) === (v.longitude === null), {
    message: "Preencha ambas as coordenadas ou deixe ambas vazias.",
    path: ["latitude"],
  });
export type PointOfSale = z.infer<typeof pointSchema>;
export const serviceSchema = z.object({
  id: z.enum(SERVICE_IDS),
  title: text(100).min(1),
  summary: text(300).min(1),
  body: text(10000).min(1),
  enabled: z.boolean(),
});
export function isGoogleMapsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (u.hostname === "maps.app.goo.gl" ||
        u.hostname === "g.page" ||
        u.hostname === "maps.google.com" ||
        ([
          "google.com",
          "www.google.com",
          "google.pt",
          "www.google.pt",
        ].includes(u.hostname) &&
          u.pathname.startsWith("/maps")))
    );
  } catch {
    return false;
  }
}
export const showroomSchema = z.object({
  locations: z
    .array(pointSchema)
    .max(20)
    .refine(
      (a) => new Set(a.map((v) => v.id)).size === a.length,
      "Identificadores de pontos de venda repetidos.",
    ),
  faqs: z.array(faqSchema).max(60),
  services: z
    .array(serviceSchema)
    .length(4)
    .refine(
      (a) => new Set(a.map((v) => v.id)).size === 4,
      "Cada serviço deve aparecer uma vez.",
    ),
  google: z
    .object({
      enabled: z.boolean(),
      placeId: text(200).regex(/^[a-zA-Z0-9_-]*$/, "Place ID inválido."),
      mapsUrl: z.union([
        z.literal(""),
        z
          .string()
          .refine(isGoogleMapsUrl, "Utilize uma ligação HTTPS do Google Maps."),
      ]),
    })
    .refine(
      (v) => !v.enabled || Boolean(v.placeId || v.mapsUrl),
      "Indique o Place ID ou a ligação do perfil Google.",
    ),
});
export type ShowroomContent = z.infer<typeof showroomSchema>;
export const DEFAULT_SHOWROOM: ShowroomContent = {
  locations: [],
  google: { enabled: false, placeId: "", mapsUrl: "" },
  faqs: [
    {
      category: "geral",
      question: "Como posso conhecer uma viatura?",
      answer:
        "Abra o anúncio e use \"Pedir contacto\" ou fale connosco por WhatsApp. A equipa combina consigo a visita ao stand e confirma a disponibilidade.",
    },
    {
      category: "geral",
      question: "Posso propor uma retoma?",
      answer:
        "Sim. Envie os dados do seu veículo na página Vender ou Encomendar. A avaliação será confirmada pela equipa após análise da viatura.",
    },
    {
      category: "geral",
      question: "Não encontro o carro que procuro. Podem ajudar?",
      answer:
        "Pode enviar um pedido de viatura por encomenda com as características e o orçamento pretendidos.",
    },
    {
      category: "garantia",
      question: "Onde consulto a garantia de uma viatura?",
      answer:
        "Consulte a duração indicada no anúncio e peça à equipa as condições e a cobertura aplicáveis antes de avançar.",
    },
  ],
  services: [
    {
      id: "financiamento",
      title: "Financiamento",
      summary: "Esclareça as opções para a compra da sua viatura.",
      body: "Fale com a equipa para conhecer a disponibilidade de soluções de financiamento e as condições aplicáveis ao seu caso.\n\nO envio de um contacto não constitui uma proposta de crédito nem uma aprovação. Solicite a identificação da entidade responsável, os custos e a documentação necessária antes de avançar.",
      enabled: true,
    },
    {
      id: "garantia",
      title: "Garantia",
      summary: "Conheça a proteção associada à viatura que pretende comprar.",
      body: "A duração da garantia, quando indicada, está disponível na ficha de cada viatura.\n\nPeça à equipa as condições por escrito, a cobertura e o procedimento de assistência aplicáveis ao veículo que escolheu.",
      enabled: true,
    },
    {
      id: "oficina",
      title: "Oficina e assistência",
      summary:
        "Contacte-nos para esclarecer as opções de manutenção e assistência.",
      body: "Indique a viatura e o serviço pretendido para confirmar a disponibilidade, o local de atendimento e a necessidade de marcação.\n\nO agendamento e qualquer orçamento ficam sujeitos a confirmação pela equipa.",
      enabled: false,
    },
    {
      id: "encomendas",
      title: "Viaturas por encomenda",
      summary: "Diga-nos o que procura, mesmo que ainda não esteja em stock.",
      body: "Partilhe o modelo, o orçamento e as características que valoriza. A equipa analisará o pedido e entrará em contacto sobre as opções disponíveis.\n\nO pedido não representa uma compra nem exige pagamento online.",
      enabled: true,
    },
  ],
};
export function parseShowroom(input: unknown): ShowroomContent {
  const parsed = showroomSchema.safeParse(input);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SHOWROOM);
}

/**
 * Corrige identificadores de pontos de venda.
 *
 * O identificador liga a viatura ao ponto, por isso um id válido nunca muda —
 * mudá-lo desligaria as viaturas. Só se corrige o que não passa na regra
 * (minúsculas, números e hífen), gerando-o a partir do nome. Ids repetidos
 * ganham um sufixo, senão dois pontos diferentes apontariam para o mesmo sítio.
 */
export function normalizeLocationIds<T extends { id: string; name: string }>(
  locations: T[],
): T[] {
  const usados = new Set<string>();
  return locations.map((l, i) => {
    const valido = /^[a-z0-9-]+$/.test(l.id);
    const base = valido ? l.id : slugify(l.name) || `ponto-${i + 1}`;
    let id = base;
    for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
    usados.add(id);
    return id === l.id ? l : { ...l, id };
  });
}

const CAMPOS: Record<string, string> = {
  id: "identificador",
  name: "nome",
  address: "morada",
  city: "localidade",
  postalCode: "código postal",
  phone: "telefone",
  email: "email",
  hours: "horários",
  latitude: "latitude",
  longitude: "longitude",
  title: "título",
  summary: "resumo",
  body: "texto",
  question: "pergunta",
  answer: "resposta",
  category: "categoria",
};

const SECCOES: Record<string, string> = {
  locations: "Ponto de venda",
  services: "Serviço",
  faqs: "Pergunta",
};

/**
 * Traduz o caminho de um erro de validação para linguagem do utilizador:
 * `locations → 0 → id` passa a `Ponto de venda 1 · identificador`.
 */
export function describeIssuePath(path: (string | number)[]): string {
  const [seccao, indice, campo] = path;
  const nome = typeof seccao === "string" ? SECCOES[seccao] : undefined;
  if (nome && typeof indice === "number") {
    const sufixo = typeof campo === "string" ? ` · ${CAMPOS[campo] ?? campo}` : "";
    return `${nome} ${indice + 1}${sufixo}`;
  }
  return path.map((p) => (typeof p === "string" ? (CAMPOS[p] ?? p) : p)).join(" → ");
}
