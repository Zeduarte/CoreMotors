import { z } from "zod";
import { worklogHours } from "@/lib/operations";
import { formatPlate, isPlausiblePlate, plateKey } from "@/lib/plate";
import { BODY_TYPES, FUEL_TYPES, TRANSMISSIONS, carFormSchema } from "@/lib/schemas";
import { CAR_STATUS_LABEL, LEAD_STATUS_LABEL, excerpt } from "@/lib/whatsapp/describe";
import { REPLIES, SECTION_LABEL } from "@/lib/whatsapp/replies";

/**
 * As acções que podem ser propostas, e a sua validação.
 *
 * O modelo PROPÕE; isto valida. Uma proposta que não passe daqui nunca chega a
 * ser mostrada à pessoa nem guardada, por isso o que fica pendente é sempre
 * executável — e o que é executado é sempre o que foi mostrado.
 *
 * `veiculo`, `contacto`, `autor`… são rótulos legíveis que vão na frase e na
 * imagem; `carId`, `leadId`… são os identificadores reais, resolvidos pelo
 * servidor a partir dos V1/C1/T1/P1 que uma procura devolveu. O modelo nunca vê
 * nem escreve nenhum dos dois.
 *
 * Cada construtor volta a verificar a secção da pessoa. A mesma verificação é
 * repetida no SQL (`wa_begin_as`): aqui serve para a pessoa ler uma frase útil
 * em vez de uma proposta que ia falhar ao confirmar.
 */

export const COST_CATEGORIES = [
  "transport",
  "parts",
  "labour",
  "preparation",
  "other",
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

/** Categorias que bastam ter a Oficina — material, não dinheiro de gestão. */
const WORKSHOP_CATEGORIES: readonly CostCategory[] = ["parts", "other"];

/** Estados que se podem PEDIR para uma viatura (reservada e vendida são recusadas com explicação). */
export const CAR_STATUS_TARGETS = ["published", "draft", "reserved", "sold"] as const;
/** Estados que se podem PEDIR para um contacto (ganho é recusado com explicação). */
export const LEAD_STATUS_TARGETS = ["new", "contacted", "proposal", "won", "lost", "closed"] as const;
/** Os tipos de actividade do backoffice («Registar contacto»). */
export const NOTE_KINDS = ["note", "call", "message", "proposal", "visit"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/**
 * Texto longo (descrição, nota) fica por 600 caracteres neste canal. Não é a
 * base de dados que o pede: é a frase de confirmação, que leva o texto todo e
 * vai como legenda da imagem — e a Meta corta a legenda aos 1024. Um texto que
 * a pessoa não lesse inteiro não podia ser confirmado por ela.
 */
export const MAX_TEXT = 600;

type Fuel = (typeof FUEL_TYPES)[number];
type Gearbox = (typeof TRANSMISSIONS)[number];
type Body = (typeof BODY_TYPES)[number];

export type PendingAction =
  | { kind: "register_vehicle"; nome: string; matricula: string; tipo: "car" | "motorcycle" }
  | {
      kind: "add_cost";
      carId: string;
      veiculo: string;
      categoria: CostCategory;
      descricao: string;
      valor: number;
      data: string;
    }
  | {
      kind: "log_hours";
      carId: string;
      veiculo: string;
      data: string;
      inicio: string;
      fim: string;
      horas: number;
      descricao: string;
    }
  | {
      kind: "create_draft_car";
      tipo: "car" | "motorcycle";
      marca: string;
      modelo: string;
      versao: string;
      ano: number;
      km: number;
      combustivel: Fuel;
      caixa: Gearbox;
      segmento: Body;
      /** `null` = «sob consulta». */
      preco: number | null;
      /** Canónica ("33AD22"), ou vazia. */
      matricula: string;
      cor: string;
      portas: number;
      lugares: number;
    }
  | {
      kind: "update_car";
      carId: string;
      veiculo: string;
      /** Só o que muda. `preco: null` = passa a «sob consulta». */
      novo: { preco?: number | null; km?: number; tagline?: string; descricao?: string };
      /** O que está gravado agora — só para mostrar o «antes». */
      antes: { preco: number | null; km: number; tagline: string; descricao: string };
    }
  | {
      kind: "set_car_status";
      carId: string;
      veiculo: string;
      de: string;
      para: "draft" | "published";
    }
  | {
      kind: "set_lead_status";
      leadId: string;
      contacto: string;
      de: string;
      para: "new" | "contacted" | "proposal" | "lost" | "closed";
      /** Motivo de perda; vazio nos outros estados. */
      motivo: string;
    }
  | {
      kind: "assign_lead";
      leadId: string;
      contacto: string;
      responsavelId: string;
      responsavel: string;
      /** Quem era (ou «Por atribuir») — só para mostrar. */
      antes: string;
    }
  | {
      kind: "add_lead_note";
      leadId: string;
      contacto: string;
      tipo: NoteKind;
      texto: string;
    }
  | {
      kind: "set_testimonial";
      testimonialId: string;
      autor: string;
      classificacao: number;
      excerto: string;
      publicar: boolean;
    };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Um identificador curto devolvido por uma procura (V1, C2, T1, P3). */
const handle = z.string().trim().min(1).max(10);

/** O que o modelo pode pedir para cada proposta. */
export const RegisterInput = z.object({
  nome: z.string().trim().min(2).max(120),
  matricula: z.string().trim().min(2).max(20),
  tipo: z.enum(["car", "motorcycle"]).default("car"),
});

export const CostInput = z.object({
  viatura: handle,
  categoria: z.enum(COST_CATEGORIES),
  valor: z.number().positive().max(9_999_999),
  descricao: z.string().trim().min(1).max(500),
  data: z.string().regex(DIA).optional(),
});

export const HoursInput = z.object({
  viatura: handle,
  data: z.string().regex(DIA),
  inicio: z.string().regex(HHMM),
  fim: z.string().regex(HHMM),
  noite: z.boolean().default(false),
  descricao: z.string().trim().max(2000).optional(),
});

const price = z.number().int("O preço é em euros, sem cêntimos.").positive().max(99_999_999);
const mileage = z.number().int().min(0).max(2_000_000);

export const CreateCarInput = z
  .object({
    tipo: z.enum(["car", "motorcycle"]).default("car"),
    marca: z.string().trim().min(1).max(60),
    modelo: z.string().trim().min(1).max(80),
    versao: z.string().trim().max(80).optional(),
    ano: z.number().int(),
    km: mileage,
    combustivel: z.enum(FUEL_TYPES),
    caixa: z.enum(TRANSMISSIONS),
    segmento: z.enum(BODY_TYPES),
    preco: price.optional(),
    sob_consulta: z.boolean().default(false),
    matricula: z.string().trim().max(20).optional(),
    cor: z.string().trim().max(60).optional(),
    portas: z.number().int().min(0).max(9).optional(),
    lugares: z.number().int().min(1).max(9).optional(),
  })
  // Recuperável: o modelo pergunta o preço em vez de o inventar.
  .refine((v) => v.sob_consulta || v.preco != null, {
    message: "falta o preço (ou «sob consulta») — pergunta à pessoa",
  });

export const UpdateCarInput = z
  .object({
    viatura: handle,
    preco: price.optional(),
    sob_consulta: z.boolean().optional(),
    km: mileage.optional(),
    tagline: z.string().trim().min(1).max(160).optional(),
    descricao: z.string().trim().min(1).max(MAX_TEXT).optional(),
  })
  .refine(
    (v) => v.preco != null || v.sob_consulta || v.km != null || v.tagline || v.descricao,
    { message: "indica o que muda (preço, km, frase de destaque ou descrição)" },
  )
  .refine((v) => !(v.preco != null && v.sob_consulta), {
    message: "ou um preço, ou «sob consulta» — não os dois",
  });

export const CarStatusInput = z.object({
  viatura: handle,
  estado: z.enum(CAR_STATUS_TARGETS),
});

export const LeadStatusInput = z
  .object({
    contacto: handle,
    estado: z.enum(LEAD_STATUS_TARGETS),
    motivo: z.string().trim().max(1000).optional(),
  })
  // A regra do backoffice: um perdido leva sempre o motivo. Recuperável — o
  // modelo pergunta qual foi, em vez de o inventar.
  .refine((v) => v.estado !== "lost" || Boolean(v.motivo), {
    message: "para dar como perdido é preciso o motivo — pergunta qual foi",
  });

export const AssignLeadInput = z.object({
  contacto: handle,
  responsavel: handle,
});

export const LeadNoteInput = z.object({
  contacto: handle,
  texto: z.string().trim().min(1).max(MAX_TEXT),
  tipo: z.enum(NOTE_KINDS).default("note"),
});

export const TestimonialInput = z.object({
  testemunho: handle,
  acao: z.enum(["aprovar", "rejeitar"]),
});

export type BuildResult =
  | { ok: true; action: PendingAction }
  | { ok: false; error: string };

const semSecao = (secao: string): BuildResult => ({
  ok: false,
  error: REPLIES.semSecao(SECTION_LABEL[secao] ?? secao),
});

/** A pessoa pode lançar um custo desta categoria? */
export function canUseCategory(
  categoria: CostCategory,
  sections: readonly string[],
): boolean {
  if (sections.includes("financeiro")) return true;
  return WORKSHOP_CATEGORIES.includes(categoria) && sections.includes("oficina");
}

export function buildRegister(
  input: z.infer<typeof RegisterInput>,
  sections: readonly string[],
): BuildResult {
  if (!sections.includes("oficina"))
    return { ok: false, error: "Não tem acesso à Oficina. Fale com o responsável." };
  if (!isPlausiblePlate(input.matricula))
    return {
      ok: false,
      error: "Essa matrícula não parece válida. Indique-a com 6 caracteres, ex.: 00-TE-00.",
    };
  return {
    ok: true,
    action: {
      kind: "register_vehicle",
      nome: input.nome,
      matricula: plateKey(input.matricula),
      tipo: input.tipo,
    },
  };
}

export function buildCost(
  input: z.infer<typeof CostInput>,
  vehicle: { carId: string; veiculo: string },
  sections: readonly string[],
  today: string,
): BuildResult {
  if (!canUseCategory(input.categoria, sections)) {
    // Mensagem útil em vez de "sem permissão": o mecânico quase sempre queria
    // lançar material e escolheu a categoria errada.
    return sections.includes("oficina")
      ? {
          ok: false,
          error: "Mão de obra sai das horas, não de uma despesa. Se for material, digo peças.",
        }
      : { ok: false, error: "Não tem acesso a Custos e margens. Fale com o responsável." };
  }
  const data = input.data ?? today;
  if (data > today) return { ok: false, error: "Essa data é no futuro." };
  return {
    ok: true,
    action: {
      kind: "add_cost",
      carId: vehicle.carId,
      veiculo: vehicle.veiculo,
      categoria: input.categoria,
      descricao: input.descricao,
      valor: Math.round(input.valor * 100) / 100,
      data,
    },
  };
}

export function buildHours(
  input: z.infer<typeof HoursInput>,
  vehicle: { carId: string; veiculo: string },
  sections: readonly string[],
  today: string,
): BuildResult {
  if (!sections.includes("oficina"))
    return { ok: false, error: "Não tem acesso à Oficina. Fale com o responsável." };
  if (input.data > today) return { ok: false, error: "Essa data é no futuro." };
  // A mesma regra do backoffice, na mesma função: duração zero recusada e
  // intervalo invertido só como trabalho nocturno declarado.
  const duracao = worklogHours(input.inicio, input.fim, input.noite);
  if ("error" in duracao) return { ok: false, error: duracao.error };
  return {
    ok: true,
    action: {
      kind: "log_hours",
      carId: vehicle.carId,
      veiculo: vehicle.veiculo,
      data: input.data,
      inicio: input.inicio,
      fim: input.fim,
      horas: duracao.hours,
      descricao: input.descricao?.trim() ?? "",
    },
  };
}

// ---------------------------------------------------------------------------
// Viaturas
// ---------------------------------------------------------------------------

/**
 * Viatura nova em rascunho. A validação é a do formulário do backoffice
 * (`carFormSchema`), corrida aqui sobre os mesmos campos: assim um segmento de
 * mota num carro, um ano impossível ou a falta de preço são recusados pela
 * MESMA regra que no backoffice, e não por uma cópia que um dia divergia.
 */
export function buildCreateCar(
  input: z.infer<typeof CreateCarInput>,
  sections: readonly string[],
  vehicleTypes: readonly string[],
): BuildResult {
  if (!sections.includes("carros")) return semSecao("carros");
  if (!vehicleTypes.includes(input.tipo))
    return {
      ok: false,
      error: `Não tem acesso a ${input.tipo === "motorcycle" ? "motas" : "carros"}. Fale com o responsável.`,
    };
  if (input.matricula && !isPlausiblePlate(input.matricula))
    return {
      ok: false,
      error: "Essa matrícula não parece válida. Indique-a com 6 caracteres, ex.: 00-TE-00.",
    };

  const moto = input.tipo === "motorcycle";
  const form = carFormSchema.safeParse({
    vehicle_type: input.tipo,
    make: input.marca,
    model: input.modelo,
    variant: input.versao ?? "",
    year: input.ano,
    license_plate: input.matricula ? formatPlate(input.matricula) : "",
    mileage: input.km,
    fuel: input.combustivel,
    transmission: input.caixa,
    body: input.segmento,
    color: input.cor ?? "",
    doors: input.portas ?? (moto ? 0 : 5),
    seats: input.lugares ?? (moto ? 2 : 5),
    price_on_request: input.sob_consulta,
    price: input.sob_consulta ? null : input.preco,
    status: "draft",
  });
  if (!form.success)
    return {
      ok: false,
      error: `Não dá para criar a viatura assim: ${form.error.issues[0]?.message ?? "dados inválidos"}.`,
    };

  const v = form.data;
  return {
    ok: true,
    action: {
      kind: "create_draft_car",
      tipo: v.vehicle_type,
      marca: v.make,
      modelo: v.model,
      versao: v.variant ?? "",
      ano: v.year,
      km: v.mileage,
      combustivel: v.fuel,
      caixa: v.transmission,
      segmento: v.body,
      preco: v.price_on_request ? null : (v.price ?? null),
      matricula: input.matricula ? plateKey(input.matricula) : "",
      cor: v.color ?? "",
      portas: v.doors,
      lugares: v.seats,
    },
  };
}

/** O que está gravado numa viatura, lido no momento da proposta. */
export interface CarSnapshot {
  status: string;
  price: number | null;
  price_on_request: boolean;
  mileage: number;
  tagline: string | null;
  description: string | null;
  year: number | null;
  fuel: string | null;
  transmission: string | null;
  body: string | null;
  model: string;
  reservaAtiva: boolean;
}

export function buildUpdateCar(
  input: z.infer<typeof UpdateCarInput>,
  vehicle: { carId: string; veiculo: string },
  current: CarSnapshot,
  sections: readonly string[],
): BuildResult {
  if (!sections.includes("carros")) return semSecao("carros");
  const precoAtual = current.price_on_request ? null : current.price;

  // Só entra o que muda de facto: a frase e a imagem mostram o que vai ser
  // gravado, e um «passa de 25 000 € a 25 000 €» só confundia.
  const novo: Extract<PendingAction, { kind: "update_car" }>["novo"] = {};
  if (input.sob_consulta && precoAtual !== null) novo.preco = null;
  if (input.preco != null && input.preco !== precoAtual) novo.preco = input.preco;
  if (input.km != null && input.km !== current.mileage) novo.km = input.km;
  if (input.tagline && input.tagline !== (current.tagline ?? "")) novo.tagline = input.tagline;
  if (input.descricao && input.descricao !== (current.description ?? ""))
    novo.descricao = input.descricao;
  if (!Object.keys(novo).length) return { ok: false, error: "Isso já está assim. Não há nada a alterar." };

  return {
    ok: true,
    action: {
      kind: "update_car",
      carId: vehicle.carId,
      veiculo: vehicle.veiculo,
      novo,
      antes: {
        preco: precoAtual,
        km: current.mileage,
        tagline: current.tagline ?? "",
        descricao: current.description ?? "",
      },
    },
  };
}

/**
 * Publicar ou passar a rascunho. Cada recusa diz ONDE se faz o que foi pedido:
 * reservar e vender têm fluxo próprio no contacto do cliente, e a oficina tem
 * os seus botões. As mesmas regras estão no SQL (`wa_set_car_status`).
 */
export function buildCarStatus(
  input: z.infer<typeof CarStatusInput>,
  vehicle: { carId: string; veiculo: string },
  current: CarSnapshot,
  sections: readonly string[],
): BuildResult {
  if (!sections.includes("carros")) return semSecao("carros");
  if (input.estado === "reserved") return { ok: false, error: REPLIES.reservaNoBackoffice };
  if (input.estado === "sold") return { ok: false, error: REPLIES.vendaNoBackoffice };
  if (current.status === input.estado)
    return { ok: false, error: `Essa viatura já está como «${CAR_STATUS_LABEL[input.estado]}».` };
  if (current.status === "workshop")
    return {
      ok: false,
      error: "Essa viatura está na oficina: primeiro tem de ser dada como preparada, na Oficina.",
    };
  if (current.status === "sold")
    return { ok: false, error: "Essa viatura já foi vendida. Isso trata-se no backoffice." };
  if (current.reservaAtiva) return { ok: false, error: REPLIES.reservaAtiva };
  if (input.estado === "published") {
    if (!current.year || !current.fuel || !current.transmission || !current.body || current.model === "—")
      return {
        ok: false,
        error:
          "Para publicar, a ficha tem de ter ano, combustível, caixa e segmento. Complete-a no backoffice.",
      };
    if (!current.price_on_request && !(Number(current.price) > 0))
      return { ok: false, error: "Para publicar falta o preço. Diga-me o preço primeiro." };
  }
  return {
    ok: true,
    action: {
      kind: "set_car_status",
      carId: vehicle.carId,
      veiculo: vehicle.veiculo,
      de: current.status,
      para: input.estado,
    },
  };
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/** Um contacto devolvido por `procurar_contacto`. */
export interface LeadRef {
  id: string;
  label: string;
  status: string;
  assigned_to: string | null;
  assigned_name: string | null;
  active_reservation: boolean;
}

export function buildLeadStatus(
  input: z.infer<typeof LeadStatusInput>,
  lead: LeadRef,
  sections: readonly string[],
): BuildResult {
  if (!sections.includes("leads")) return semSecao("leads");
  if (input.estado === "won") return { ok: false, error: REPLIES.vendaNoBackoffice };
  if (lead.status === "won")
    return { ok: false, error: "A venda deste contacto já está concluída. Isso já não se altera." };
  if (lead.status === input.estado)
    return { ok: false, error: `Esse contacto já está como «${LEAD_STATUS_LABEL[input.estado]}».` };
  if ((input.estado === "lost" || input.estado === "closed") && lead.active_reservation)
    return { ok: false, error: REPLIES.reservaAtiva };
  return {
    ok: true,
    action: {
      kind: "set_lead_status",
      leadId: lead.id,
      contacto: lead.label,
      de: lead.status,
      para: input.estado,
      motivo: input.estado === "lost" ? (input.motivo ?? "").trim() : "",
    },
  };
}

export function buildAssignLead(
  lead: LeadRef,
  staff: { id: string; nome: string },
  sections: readonly string[],
): BuildResult {
  if (!sections.includes("leads")) return semSecao("leads");
  if (lead.assigned_to === staff.id)
    return { ok: false, error: `${staff.nome} já é o responsável desse contacto.` };
  return {
    ok: true,
    action: {
      kind: "assign_lead",
      leadId: lead.id,
      contacto: lead.label,
      responsavelId: staff.id,
      responsavel: staff.nome,
      antes: lead.assigned_name ?? "Por atribuir",
    },
  };
}

export function buildLeadNote(
  input: z.infer<typeof LeadNoteInput>,
  lead: LeadRef,
  sections: readonly string[],
): BuildResult {
  if (!sections.includes("leads")) return semSecao("leads");
  return {
    ok: true,
    action: {
      kind: "add_lead_note",
      leadId: lead.id,
      contacto: lead.label,
      tipo: input.tipo,
      texto: input.texto,
    },
  };
}

// ---------------------------------------------------------------------------
// Testemunhos
// ---------------------------------------------------------------------------

/** Um testemunho devolvido por `procurar_testemunho`. */
export interface TestimonialRef {
  id: string;
  name: string;
  rating: number;
  body: string;
  published: boolean;
}

export function buildTestimonial(
  input: z.infer<typeof TestimonialInput>,
  t: TestimonialRef,
  sections: readonly string[],
): BuildResult {
  if (!sections.includes("testemunhos")) return semSecao("testemunhos");
  const publicar = input.acao === "aprovar";
  if (publicar && t.published)
    return { ok: false, error: "Esse testemunho já está publicado no site." };
  // Rejeitar é retirar do site. Um testemunho por aprovar já não aparece; apagá-lo
  // é no backoffice, como tudo o que se apaga.
  if (!publicar && !t.published)
    return {
      ok: false,
      error: "Esse testemunho não está publicado no site. Para o apagar, use o backoffice.",
    };
  return {
    ok: true,
    action: {
      kind: "set_testimonial",
      testimonialId: t.id,
      autor: t.name,
      classificacao: t.rating,
      excerto: excerpt(t.body, 160),
      publicar,
    },
  };
}

/**
 * Validação de uma acção lida da base de dados.
 *
 * A linha foi escrita por nós, já validada, mas uma proposta que tenha sido
 * mexida à mão não deve poder ser executada — e a confirmação é o momento em que
 * se grava de verdade, por isso vale a pena a rede.
 */
const uuid = z.string().uuid();
const label = z.string().min(1).max(300);

export const PendingActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("register_vehicle"),
    nome: z.string().min(1).max(120),
    matricula: z.string().min(2).max(20),
    tipo: z.enum(["car", "motorcycle"]),
  }),
  z.object({
    kind: z.literal("add_cost"),
    carId: uuid,
    veiculo: z.string().min(1),
    categoria: z.enum(COST_CATEGORIES),
    descricao: z.string().min(1).max(500),
    valor: z.number().positive().max(9_999_999),
    data: z.string().regex(DIA),
  }),
  z.object({
    kind: z.literal("log_hours"),
    carId: uuid,
    veiculo: z.string().min(1),
    data: z.string().regex(DIA),
    inicio: z.string().regex(HHMM),
    fim: z.string().regex(HHMM),
    horas: z.number().nonnegative(),
    descricao: z.string().max(2000),
  }),
  z.object({
    kind: z.literal("create_draft_car"),
    tipo: z.enum(["car", "motorcycle"]),
    marca: z.string().min(1).max(60),
    modelo: z.string().min(1).max(80),
    versao: z.string().max(80),
    ano: z.number().int().min(1950).max(2100),
    km: mileage,
    combustivel: z.enum(FUEL_TYPES),
    caixa: z.enum(TRANSMISSIONS),
    segmento: z.enum(BODY_TYPES),
    preco: price.nullable(),
    matricula: z.string().max(6),
    cor: z.string().max(60),
    portas: z.number().int().min(0).max(9),
    lugares: z.number().int().min(1).max(9),
  }),
  z.object({
    kind: z.literal("update_car"),
    carId: uuid,
    veiculo: label,
    novo: z
      .object({
        preco: price.nullable().optional(),
        km: mileage.optional(),
        tagline: z.string().min(1).max(160).optional(),
        descricao: z.string().min(1).max(MAX_TEXT).optional(),
      })
      .strict()
      .refine((n) => Object.keys(n).length > 0),
    antes: z.object({
      preco: z.number().nullable(),
      km: z.number(),
      tagline: z.string(),
      descricao: z.string(),
    }),
  }),
  z.object({
    kind: z.literal("set_car_status"),
    carId: uuid,
    veiculo: label,
    de: z.string().min(1).max(20),
    para: z.enum(["draft", "published"]),
  }),
  z.object({
    kind: z.literal("set_lead_status"),
    leadId: uuid,
    contacto: label,
    de: z.string().min(1).max(20),
    para: z.enum(["new", "contacted", "proposal", "lost", "closed"]),
    motivo: z.string().max(1000),
  }),
  z.object({
    kind: z.literal("assign_lead"),
    leadId: uuid,
    contacto: label,
    responsavelId: uuid,
    responsavel: label,
    antes: label,
  }),
  z.object({
    kind: z.literal("add_lead_note"),
    leadId: uuid,
    contacto: label,
    tipo: z.enum(NOTE_KINDS),
    texto: z.string().min(1).max(MAX_TEXT),
  }),
  z.object({
    kind: z.literal("set_testimonial"),
    testimonialId: uuid,
    autor: label,
    classificacao: z.number().int().min(1).max(5),
    excerto: z.string().max(300),
    publicar: z.boolean(),
  }),
]);
