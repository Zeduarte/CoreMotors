import { z } from "zod";
import { MOTORCYCLE_BODIES, isMotorcycleBody } from "./vehicle-categories";
import { canonicalBrand } from "./brand-name";

/**
 * Esquemas de validação partilhados (cliente + servidor).
 *
 * O mesmo `carFormSchema` valida o formulário (React Hook Form) e a Server
 * Action — nunca confiar apenas no cliente.
 */

export const FUEL_TYPES = [
  "Gasolina",
  "Diesel",
  "Híbrido",
  "Híbrido Plug-in",
  "Elétrico",
  "GPL",
] as const;

export const TRANSMISSIONS = ["Manual", "Automática"] as const;

export const BODY_TYPES = [
  "Berlina",
  "SUV",
  "Coupé",
  "Carrinha",
  "Citadino",
  "Utilitário",
  "Descapotável",
  "Monovolume",
  ...MOTORCYCLE_BODIES,
] as const;

export const CAR_STATUSES = ["workshop", "draft", "prepared", "published", "reserved", "sold"] as const;
/**
 * Estados que se escolhem em Viaturas. "Na oficina" fica de fora: uma viatura
 * na oficina não aparece em Viaturas, e voltar para lá é um botão próprio.
 */
export const LISTING_STATUSES = CAR_STATUSES.filter((s) => s !== "workshop");

/**
 * Plataformas/portais externos para onde o inventário pode ser exportado.
 * O `id` é usado no URL do feed (`/api/feeds/<id>.xml`) e nas credenciais.
 */
export const CHANNELS = [
  { id: "standvirtual", label: "StandVirtual", available: false },
  { id: "olx", label: "OLX", available: true },
  { id: "autosapo", label: "auto SAPO", available: false },
  { id: "custojusto", label: "CustoJusto", available: false },
  { id: "piscapisca", label: "Piscapisca", available: false },
] as const;

/** Só o OLX publica de verdade por agora; os outros ficam «Brevemente». */
export const AVAILABLE_CHANNEL_IDS: readonly string[] = CHANNELS.filter((c) => c.available).map((c) => c.id);
export const COMING_SOON = "Brevemente disponível";

export const CHANNEL_IDS = CHANNELS.map((c) => c.id);
export type ChannelId = (typeof CHANNELS)[number]["id"];

/**
 * Número inteiro OPCIONAL vindo de um `<input type="number">` vazio.
 *
 * `z.coerce.number()` sozinho transforma `""` em `0` (é o que `Number("")`
 * devolve), pelo que um campo em branco ficava gravado como zero e o anúncio
 * passava a afirmar, por exemplo, "Nº de donos 0". Aqui o vazio é nulo:
 * desconhecido e zero deixam de se confundir.
 */
function optionalInt(min: number, max: number) {
  return z
    .preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.coerce.number().int().min(min).max(max).nullable(),
    )
    .optional();
}

export const carFormSchema = z
  .object({
    vehicle_type: z.enum(["car", "motorcycle"]).default("car"),
    registration_month: optionalInt(1, 12),
    point_of_sale_id: z.string().trim().max(80).nullable().optional(),
    // Grafia canónica: senão "BMW" e "Bmw" ficavam como marcas distintas.
    make: z
      .string()
      .trim()
      .min(1, "Indique a marca")
      .transform(canonicalBrand),
    model: z.string().trim().min(1, "Indique o modelo"),
    variant: z.string().trim().max(80).optional().or(z.literal("")),
    year: z.coerce
      .number()
      .int()
      .min(1950, "Ano inválido")
      .max(new Date().getFullYear() + 1, "Ano inválido"),
    license_plate: z.string().trim().max(20).optional().or(z.literal("")),

    mileage: z.coerce.number().int().min(0, "Km inválidos"),
    fuel: z.enum(FUEL_TYPES),
    transmission: z.enum(TRANSMISSIONS),
    body: z.enum(BODY_TYPES),
    power: z.coerce.number().int().min(0).default(0),
    displacement: z.coerce.number().int().min(0).default(0),
    color: z.string().trim().max(60).optional().or(z.literal("")),
    doors: z.coerce.number().int().min(0).max(9).default(5),
    seats: z.coerce.number().int().min(1).max(9).default(5),

    price_on_request: z.boolean().default(false),
    price: optionalInt(0, 99999999),
    status: z.enum(CAR_STATUSES).default("draft"),
    featured: z.boolean().default(false),

    tagline: z.string().trim().max(160).optional().or(z.literal("")),
    description: z.string().trim().max(5000).optional().or(z.literal("")),
    extras: z.array(z.string().trim().min(1)).default([]),
    location: z.string().trim().max(120).optional().or(z.literal("")),

    // Transparência / badges
    previous_price: optionalInt(0, 99999999),
    national: z.boolean().default(false),
    // Zero também é "não sei": aceita-se para não travar anúncios antigos
    // gravados com o campo em branco, mas fica nulo.
    owners: z
      .preprocess(
        (v) => (v === "" || v == null || v === 0 || v === "0" ? null : v),
        z.coerce.number().int().min(1).max(20).nullable(),
      )
      .optional(),
    first_owner: z.boolean().default(false),
    service_book: z.boolean().default(false),
    warranty_months: optionalInt(0, 120),
    last_inspection: z.string().optional().or(z.literal("")),

    // Exportação multi-canal (portais externos onde publicar)
    channels: z.array(z.string().trim().min(1)).default([]),

    // «Campos do OLX»: { código: valor | [valores] }. Validados contra a
    // lista do OLX quando o anúncio é montado; aqui só se limita o tamanho.
    olx_attributes: z
      .record(z.string().max(80), z.union([z.string().max(200), z.array(z.string().max(200)).max(100)]))
      .refine((r) => Object.keys(r).length <= 200, "Demasiados campos do OLX")
      .default({}),

    // Etiquetas do stand marcadas nesta viatura (ids de Definições → Etiquetas).
    badges: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  })
  .refine((v) => v.price_on_request || (v.price != null && v.price > 0), {
    message: "Indique um preço ou marque 'sob consulta'",
    path: ["price"],
  })
  .superRefine((v, ctx) => {
    if ((v.vehicle_type === "motorcycle") !== isMotorcycleBody(v.body))
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "Escolha um segmento adequado ao tipo de viatura.",
      });
    if (v.vehicle_type === "car" && v.doors < 1)
      ctx.addIssue({
        code: "custom",
        path: ["doors"],
        message: "Indique o número de portas.",
      });
    if (v.vehicle_type === "motorcycle" && v.doors !== 0)
      ctx.addIssue({
        code: "custom",
        path: ["doors"],
        message: "Uma mota deve ter 0 portas.",
      });
    if (v.vehicle_type === "motorcycle" && v.seats > 2)
      ctx.addIssue({
        code: "custom",
        path: ["seats"],
        message: "Uma mota leva no máximo 2 lugares.",
      });
  });

export type CarFormValues = z.infer<typeof carFormSchema>;

/** Formulário público de lead (contacto / test drive / retoma / encomenda). */
export const leadSchema = z.object({
  kind: z
    .enum([
      "contact",
      "test_drive",
      "finance",
      "trade_in",
      "order",
      "reservation",
      "offer",
      "alert",
    ])
    .default("contact"),
  car_id: z.string().uuid().nullable().optional(),
  car_label: z.string().max(160).optional().or(z.literal("")),
  name: z.string().trim().min(2, "Indique o seu nome"),
  // Opcional: há quem só deixe o telefone. Um dos dois é obrigatório (abaixo).
  email: z.string().trim().email("Email inválido").optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .regex(/^[\d\s+]{9,}$/, "Telefone inválido")
    .optional()
    .or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  preferred_date: z.string().optional().or(z.literal("")),
  /** JSON com detalhes extra (ex.: carro de retoma). */
  details: z.string().max(4000).optional().or(z.literal("")),
}).refine((v) => Boolean(v.email || v.phone), {
  message: "Indique o telefone ou o email, para lhe respondermos.",
  path: ["phone"],
});

export type LeadValues = z.infer<typeof leadSchema>;

/** Testemunho submetido publicamente por um visitante (entra por aprovar). */
export const publicTestimonialSchema = z.object({
  privacyAcknowledged: z.literal(true, {
    errorMap: () => ({
      message: "Confirme a leitura da Política de Privacidade.",
    }),
  }),
  name: z.string().trim().min(2, "Indique o seu nome").max(80),
  rating: z.coerce.number().int().min(1).max(5).default(5),
  role: z.string().trim().max(80).optional().or(z.literal("")),
  body: z
    .string()
    .trim()
    .min(10, "Escreva pelo menos algumas palavras")
    .max(1000),
});
export type PublicTestimonialValues = z.infer<typeof publicTestimonialSchema>;

// ---- Conteúdo da página inicial -------------------------------------------
const cta = z.object({
  label: z.string().trim().max(60),
  href: z.string().trim().max(200),
});

export const homeContentSchema = z.object({
  hero: z.object({
    eyebrow: z.string().trim().max(80),
    title: z.string().trim().min(1, "Título obrigatório").max(160),
    subtitle: z.string().trim().max(300),
    primaryCta: cta,
    secondaryCta: cta,
    media: z.enum(["auto", "video", "image"]).default("auto"),
  }),
  motoHero: z.object({
    eyebrow: z.string().trim().max(80),
    title: z.string().trim().min(1, "Título obrigatório").max(160),
    subtitle: z.string().trim().max(300),
    primaryCta: cta,
  }),
  brands: z.array(z.string().trim().min(1)).max(30),
  trust: z.object({
    eyebrow: z.string().trim().max(80),
    title: z.string().trim().max(160),
    pillars: z
      .array(
        z.object({
          kpi: z.string().trim().max(20),
          title: z.string().trim().max(80),
          body: z.string().trim().max(400),
        }),
      )
      .max(8),
  }),
  cta: z.object({
    eyebrow: z.string().trim().max(80),
    title: z.string().trim().max(160),
    whatsappLabel: z.string().trim().max(60),
    secondary: cta,
  }),
});

export type HomeContentValues = z.infer<typeof homeContentSchema>;

// ---- Marca do site (admin) -------------------------------------------------
const hexColor = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{6})$/, "Cor inválida (use #RRGGBB)");

export const siteSettingsSchema = z.object({
  company_name: z.string().trim().min(1, "Indique o nome da empresa").max(60),
  tagline: z.string().trim().max(160).optional().or(z.literal("")),
  logo_url: z.string().trim().max(400).nullable().optional(),
  accent: hexColor.default("#E8B15A"),
  accent_soft: hexColor.default("#C8934A"),
});
export type SiteSettingsValues = z.infer<typeof siteSettingsSchema>;

// ---- Dados de contacto / empresa (admin) ----------------------------------
export const companySchema = z.object({
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z
    .string()
    .trim()
    .max(120)
    .email("Email inválido")
    .optional()
    .or(z.literal("")),
  // O wa.me só funciona com indicativo: "916193337" gerava um link morto.
  // Um número nacional de 9 dígitos é completado com o 351.
  whatsapp: z
    .string()
    .trim()
    .max(20)
    .regex(/^\d*$/, "Só dígitos, com indicativo (ex.: 351910000000)")
    .transform((v) => (/^[29]\d{8}$/.test(v) ? `351${v}` : v))
    .refine((v) => v === "" || v.length >= 11, {
      message: "Falta o indicativo do país (ex.: 351910000000).",
    })
    .optional()
    .or(z.literal("")),
  messenger: z.string().trim().max(200).optional().or(z.literal("")),
  address_street: z.string().trim().max(160).optional().or(z.literal("")),
  address_city: z.string().trim().max(80).optional().or(z.literal("")),
  address_postal: z.string().trim().max(20).optional().or(z.literal("")),
  address_country: z.string().trim().max(60).optional().or(z.literal("")),
  hours: z.string().trim().max(120).optional().or(z.literal("")),
  geo_lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  geo_lng: z.coerce.number().min(-180).max(180).nullable().optional(),
});
export type CompanyValues = z.infer<typeof companySchema>;

// ---- Marketing, reservas e consentimento (admin) --------------------------
export const marketingSchema = z.object({
  ga4_id: z
    .string()
    .trim()
    .max(40)
    .regex(/^(G-[A-Z0-9]+)?$/i, "ID GA4 inválido (ex.: G-XXXXXXX)")
    .optional()
    .or(z.literal("")),
  pixel_id: z
    .string()
    .trim()
    .max(40)
    .regex(/^\d*$/, "ID do Pixel inválido (só dígitos)")
    .optional()
    .or(z.literal("")),
  reservation_enabled: z.boolean().default(false),
  deposit_amount: z.coerce.number().int().min(0).max(100000).default(500),
});
export type MarketingValues = z.infer<typeof marketingSchema>;

// ---- Oficina (admin) ------------------------------------------------------
export const workshopSchema = z.object({
  workshop_hourly_rate: z.coerce
    .number()
    .min(0, "Valor inválido")
    .max(1000, "Valor demasiado alto")
    .default(0),
});
export type WorkshopValues = z.infer<typeof workshopSchema>;

// ---- Etiquetas dos cards (admin) ------------------------------------------
// Partilhado pelo formulário (`saveBadges`) e pelo assistente de WhatsApp.
export const badgesSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/),
        label: z.string().trim().min(1, "Cada etiqueta precisa de um texto").max(30, "Texto da etiqueta demasiado longo"),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida"),
        enabled: z.boolean(),
      }),
    )
    .max(40),
});
export type BadgesValues = z.infer<typeof badgesSchema>;

// ---- Integrações / credenciais das plataformas (admin) --------------------
const channelCred = z
  .object({
    username: z.string().trim().max(120).optional().or(z.literal("")),
    token: z.string().trim().max(400).optional().or(z.literal("")),
    enabled: z.boolean().default(false),
  })
  .partial()
  .default({});

export const integrationsSchema = z.object({
  standvirtual: channelCred,
  olx: channelCred,
  autosapo: channelCred,
  custojusto: channelCred,
  piscapisca: channelCred,
  // `stripe_secret` e `feed_token` já não se recolhem (não havia uso: não há
  // cobrança online, ver docs/OPERATIONS.md, e os feeds não pedem token). Os
  // valores já guardados ficam — saveIntegrations não os apaga.
  /** Webhook (Slack/Discord/Make/Zapier) notificado a cada novo lead. */
  lead_webhook: z
    .string()
    .trim()
    .url("URL inválido")
    .max(500)
    .optional()
    .or(z.literal("")),
});
export type IntegrationsValues = z.infer<typeof integrationsSchema>;

// ---- Novo utilizador (admin) ----------------------------------------------
export const newUserSchema = z.object({
  full_name: z.string().trim().min(2, "Indique o nome").max(80),
  // Opcional: há quem só deixe o telefone. Um dos dois é obrigatório (abaixo).
  email: z.string().trim().email("Email inválido").optional().or(z.literal("")),
  password: z.string().min(8, "Mínimo 8 caracteres").max(72),
  role: z.enum(["admin", "chefe", "vendedor", "mecanico"]).default("vendedor"),
  /** Separadores a que o novo utilizador terá acesso (opcional). */
  allowed_sections: z.array(z.string()).optional(),
  /** Tipos de viatura acessíveis. Vazio/ausente = os dois. */
  allowed_vehicle_types: z.array(z.enum(["car", "motorcycle"])).optional(),
});
export type NewUserValues = z.infer<typeof newUserSchema>;
