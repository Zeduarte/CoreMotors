import type {
  Activity,
  Financials,
  VehicleCost,
  PreparationTask,
  Reservation,
  AuditEntry,
  NotificationJob,
  AnalyticsSummary,
  StaffMember,
} from "../operations-types";
type Table<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};
/**
 * Tipos da base de dados.
 *
 * Escritos à mão a espelhar `supabase/migrations/0001_init.sql`. Em produção
 * podem ser (re)gerados com:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public \
 *     > src/lib/supabase/database.types.ts
 *
 * Manter sincronizado com o schema é a fonte da verdade de tipos do backend.
 */

export type UserRole = "admin" | "chefe" | "vendedor" | "mecanico";
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
export type CarStatus = "workshop" | "draft" | "prepared" | "published" | "reserved" | "sold";
export type MediaKind = "image" | "video";
export type LeadKind =
  | "contact"
  | "test_drive"
  | "finance"
  | "trade_in"
  | "order"
  | "reservation"
  | "offer"
  | "alert"
  | "visit";
export type LeadStatus =
  | "new"
  | "contacted"
  | "proposal"
  | "won"
  | "lost"
  | "closed";

export type HighlightJson = {
  label: string;
  value: string;
};

// ---- profiles --------------------------------------------------------------
type ProfilesRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  allowed_sections: string[] | null;
  /** Tipos de viatura acessíveis no backoffice. NULL = ambos. */
  allowed_vehicle_types: string[] | null;
  phone: string | null;
  birth_date: string | null;
  job_title: string | null;
  /** Dono da conta: o único admin que gere outros admins. */
  is_owner: boolean;
  created_at: string;
  updated_at: string;
};
type ProfilesInsert = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role?: UserRole;
  allowed_sections?: string[] | null;
  allowed_vehicle_types?: string[] | null;
  phone?: string | null;
  birth_date?: string | null;
  job_title?: string | null;
  is_owner?: boolean;
};
type ProfilesUpdate = {
  id?: string;
  email?: string | null;
  full_name?: string | null;
  role?: UserRole;
  allowed_sections?: string[] | null;
  allowed_vehicle_types?: string[] | null;
  phone?: string | null;
  birth_date?: string | null;
  job_title?: string | null;
  is_owner?: boolean;
};

// ---- cars ------------------------------------------------------------------
type CarsRow = {
  id: string;
  slug: string;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  registration_month?: number | null;
  vehicle_type?: "car" | "motorcycle";
  point_of_sale_id?: string | null;
  license_plate: string | null;
  mileage: number;
  fuel: FuelType | null;
  transmission: Transmission | null;
  body: BodyType | null;
  power: number;
  displacement: number;
  color: string | null;
  doors: number;
  seats: number;
  price: number | null;
  price_on_request: boolean;
  status: CarStatus;
  featured: boolean;
  tagline: string | null;
  description: string | null;
  extras: string[];
  location: string | null;
  highlights: HighlightJson[];
  previous_price: number | null;
  national: boolean;
  owners: number | null;
  first_owner: boolean;
  service_book: boolean;
  warranty_months: number | null;
  last_inspection: string | null;
  channels: string[];
  /** Categoria do OLX só desta viatura (0031); nulo = a padrão do tipo. */
  olx_category_id?: number | null;
  /** «Campos do OLX» escolhidos na ficha (0032). */
  olx_attributes?: Record<string, string | string[]>;
  /** Etiquetas do stand marcadas nesta viatura (0034). */
  badges?: string[];
  created_by: string | null;
  published_at: string | null;
  sold_at: string | null;
  created_at: string;
  updated_at: string;
};
type CarsInsert = {
  id?: string;
  slug: string;
  make: string;
  model: string;
  variant?: string | null;
  year: number | null;
  registration_month?: number | null;
  vehicle_type?: "car" | "motorcycle";
  point_of_sale_id?: string | null;
  license_plate?: string | null;
  mileage?: number;
  fuel: FuelType | null;
  transmission: Transmission | null;
  body: BodyType | null;
  power?: number;
  displacement?: number;
  color?: string | null;
  doors?: number;
  seats?: number;
  price?: number | null;
  price_on_request?: boolean;
  status?: CarStatus;
  featured?: boolean;
  tagline?: string | null;
  description?: string | null;
  extras?: string[];
  location?: string | null;
  highlights?: HighlightJson[];
  previous_price?: number | null;
  national?: boolean;
  owners?: number | null;
  first_owner?: boolean;
  service_book?: boolean;
  warranty_months?: number | null;
  last_inspection?: string | null;
  channels?: string[];
  olx_category_id?: number | null;
  olx_attributes?: Record<string, string | string[]>;
  badges?: string[];
  created_by?: string | null;
};
type CarsUpdate = Partial<CarsInsert>;

// ---- car_media -------------------------------------------------------------
type CarMediaRowT = {
  id: string;
  car_id: string;
  kind: MediaKind;
  storage_path: string;
  alt: string;
  position: number;
  is_cover: boolean;
  width: number | null;
  height: number | null;
  created_at: string;
};
type CarMediaInsert = {
  id?: string;
  car_id: string;
  kind?: MediaKind;
  storage_path: string;
  alt?: string;
  position?: number;
  is_cover?: boolean;
  width?: number | null;
  height?: number | null;
};
type CarMediaUpdate = Partial<CarMediaInsert>;

// ---- leads -----------------------------------------------------------------
type LeadsRow = {
  vehicle_type: "car" | "motorcycle" | null;
  /** Visita ao stand (0042): dia e hora, estado e lembrete enviado. */
  visit_at: string | null;
  visit_status: VisitStatus | null;
  visit_reminded_at: string | null;
  assigned_to: string | null;
  next_action: string | null;
  next_action_at: string | null;
  loss_reason: string | null;
  first_contacted_at: string | null;
  id: string;
  car_id: string | null;
  car_label: string | null;
  kind: LeadKind;
  status: LeadStatus;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  preferred_date: string | null;
  notes: string | null;
  car_details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
type LeadsInsert = {
  vehicle_type?: "car" | "motorcycle" | null;
  visit_at?: string | null;
  visit_status?: VisitStatus | null;
  visit_reminded_at?: string | null;
  assigned_to?: string | null;
  next_action?: string | null;
  next_action_at?: string | null;
  loss_reason?: string | null;
  first_contacted_at?: string | null;
  id?: string;
  car_id?: string | null;
  car_label?: string | null;
  kind?: LeadKind;
  status?: LeadStatus;
  name: string;
  email: string;
  phone?: string | null;
  message?: string | null;
  preferred_date?: string | null;
  notes?: string | null;
  car_details?: Record<string, unknown>;
};
type LeadsUpdate = Partial<LeadsInsert>;

// ---- site_content ----------------------------------------------------------
type SiteContentRow = {
  key: string;
  content: Record<string, unknown>;
  updated_at: string;
};
type SiteContentInsert = {
  key: string;
  content?: Record<string, unknown>;
};
type SiteContentUpdate = Partial<SiteContentInsert>;

// ---- site_settings ---------------------------------------------------------
type SiteSettingsRow = {
  id: number;
  company_name: string;
  logo_url: string | null;
  tagline: string | null;
  accent: string;
  accent_soft: string;
  ga4_id: string | null;
  pixel_id: string | null;
  reservation_enabled: boolean;
  deposit_amount: number;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  messenger: string | null;
  address_street: string | null;
  address_city: string | null;
  address_postal: string | null;
  address_country: string | null;
  hours: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  workshop_hourly_rate: number;
  updated_at: string;
};
type SiteSettingsInsert = {
  id?: number;
  company_name?: string;
  logo_url?: string | null;
  tagline?: string | null;
  accent?: string;
  accent_soft?: string;
  ga4_id?: string | null;
  pixel_id?: string | null;
  reservation_enabled?: boolean;
  deposit_amount?: number;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  messenger?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_postal?: string | null;
  address_country?: string | null;
  hours?: string | null;
  geo_lat?: number | null;
  geo_lng?: number | null;
  workshop_hourly_rate?: number;
};
type SiteSettingsUpdate = Partial<SiteSettingsInsert>;

// ---- testimonials ----------------------------------------------------------
type TestimonialsRow = {
  id: string;
  name: string;
  rating: number;
  body: string;
  role: string | null;
  published: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};
type TestimonialsInsert = {
  id?: string;
  name: string;
  rating?: number;
  body: string;
  role?: string | null;
  published?: boolean;
  position?: number;
};
type TestimonialsUpdate = Partial<TestimonialsInsert>;

// ---- car_views -------------------------------------------------------------
type CarViewsRow = {
  id: number;
  car_id: string | null;
  slug: string | null;
  session: string | null;
  created_at: string;
};
type CarViewsInsert = {
  car_id?: string | null;
  slug?: string | null;
  session?: string | null;
};
type CarViewsUpdate = Partial<CarViewsInsert>;

// ---- integration_secrets ---------------------------------------------------
type IntegrationSecretsRow = {
  id: number;
  data: Record<string, unknown>;
  updated_at: string;
};
type IntegrationSecretsInsert = {
  id?: number;
  data?: Record<string, unknown>;
};
type IntegrationSecretsUpdate = Partial<IntegrationSecretsInsert>;

// ---- vehicle_tasks (oficina — registo de horas) ----------------------------
type VehicleTasksRow = {
  id: string;
  car_id: string;
  work_date: string; // "YYYY-MM-DD"
  start_time: string; // "HH:MM:SS"
  end_time: string | null; // "HH:MM:SS"
  description: string | null;
  hours: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
type VehicleTasksInsert = {
  id?: string;
  car_id: string;
  work_date?: string;
  start_time: string;
  end_time?: string | null;
  description?: string | null;
  hours?: number;
  created_by?: string | null;
};
type VehicleTasksUpdate = Partial<VehicleTasksInsert>;

// ---- time_entries (horas fora das viaturas, por utilizador) ----------------
type TimeEntriesRow = {
  id: string;
  profile_id: string;
  work_date: string; // "YYYY-MM-DD"
  start_time: string; // "HH:MM:SS"
  end_time: string | null;
  hours: number;
  description: string;
  created_at: string;
  updated_at: string;
};
type TimeEntriesInsert = {
  id?: string;
  profile_id?: string;
  work_date?: string;
  start_time: string;
  end_time?: string | null;
  hours?: number;
  description: string;
};
type TimeEntriesUpdate = Partial<TimeEntriesInsert>;

// ---- channel_listings (estado de publicação por portal) --------------------
export type ChannelListingStatus =
  | "pending"
  | "published"
  | "removed"
  | "error";

type ChannelListingsRow = {
  id: string;
  car_id: string;
  channel: string;
  status: ChannelListingStatus;
  external_url: string | null;
  external_id: string | null;
  published_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Sincronização automática (0025): só o OLX a usa por agora. */
  sync_state: "idle" | "pending" | "syncing" | "error";
  last_error: string | null;
  last_synced_at: string | null;
  remote_status: string | null;
  attempts: number;
  /** Estatísticas do anúncio no portal (0030): só o OLX as dá por agora. */
  views: number | null;
  phone_views: number | null;
  observers: number | null;
  stats_at: string | null;
};
type ChannelListingsInsert = {
  id?: string;
  car_id: string;
  channel: string;
  status?: ChannelListingStatus;
  external_url?: string | null;
  external_id?: string | null;
  published_at?: string | null;
  notes?: string | null;
  created_by?: string | null;
  sync_state?: "idle" | "pending" | "syncing" | "error";
  last_error?: string | null;
  last_synced_at?: string | null;
  remote_status?: string | null;
  attempts?: number;
  views?: number | null;
  phone_views?: number | null;
  observers?: number | null;
  stats_at?: string | null;
};
type ChannelListingsUpdate = Partial<ChannelListingsInsert>;

/**
 * Valor JSON, para colunas `jsonb`.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Tipos das tabelas do WhatsApp.
 *
 * São `type` e não `interface` de propósito, como todas as outras deste
 * ficheiro: o supabase-js exige que cada `Row` seja atribuível a
 * `Record<string, unknown>`, e um `interface` sem index signature não o é. Com
 * um `interface` aqui, o esquema INTEIRO passa a resolver para `never` — sem um
 * único erro neste ficheiro, e com erros em todas as páginas que usam o cliente.
 */

/** Mensagens do WhatsApp já vistas (idempotência). */
export type WaMessageRow = {
  wam_id: string;
  from_phone: string;
  actor_id: string | null;
  received_at: string;
  processed_at: string | null;
  reply_sent_at: string | null;
  last_error: string | null;
};

/** Proposta à espera de confirmação. `payload` é a acção já validada. */
export type WaPendingRow = {
  id: string;
  actor_id: string;
  from_phone: string;
  kind: string;
  payload: Json;
  summary: string;
  created_at: string;
  expires_at: string;
  status: string;
  settled_at: string | null;
  result_id: string | null;
  /** Mensagem da Meta com a imagem da proposta (0038), para o recurso a texto. */
  image_wamid: string | null;
};

/** Fotografia recebida pelo WhatsApp, à espera do «sim» (0039). */
export type WaMediaRow = {
  id: string;
  seq: number;
  from_phone: string;
  actor_id: string | null;
  media_id: string;
  storage_path: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  caption: string;
  status: string;
  car_media_id: string | null;
  created_at: string;
  settled_at: string | null;
};

/** Viatura que um colaborador pode ver (já filtrada pelas permissões). */
export type WaVehicleRow = {
  id: string;
  make: string;
  model: string;
  variant: string | null;
  color: string | null;
  license_plate: string | null;
  status: string;
  vehicle_type: string;
};

/** Contacto que um colaborador pode alterar (0038, já filtrado). */
export type WaLeadRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  car_label: string | null;
  vehicle_type: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  /** Tem uma reserva activa: não se perde nem se fecha por mensagem. */
  active_reservation: boolean;
  created_at: string;
  total: number;
};

/** Testemunho que um colaborador pode aprovar ou rejeitar (0038). */
export type WaTestimonialRow = {
  id: string;
  name: string;
  rating: number;
  role: string | null;
  body: string;
  published: boolean;
  created_at: string;
  total: number;
};

/** Colaborador que pode ser responsável de um contacto (0038). */
export type WaStaffRow = { id: string; full_name: string; total: number };

export type WaVehicleSummary = {
  costs: number;
  cost_count: number;
  hours: number;
  status: string;
};

/** Ligação à conta do OLX. Só o servidor lê esta linha (tem os tokens). */
export type OlxConnectionRow = {
  id: number;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  olx_user_id: string | null;
  olx_user_name: string | null;
  city_id: number | null;
  district_id: number | null;
  connected_by: string | null;
  connected_at: string;
  updated_at: string;
};

/** Número de WhatsApp da empresa ligado no backoffice. Só o servidor lê (tem o token). */
/** Contacto externo do número da marca (0043): identifica-se pela empresa e pelo cargo. */
export type WaContactRow = {
  phone: string;
  profile_name: string | null;
  name: string | null;
  company: string | null;
  role: string | null;
  step: "company" | "role" | "done";
  first_message: string | null;
  last_message: string | null;
  messages: number;
  created_at: string;
  last_message_at: string;
};

export type WhatsAppConnectionRow = {
  id: number;
  waba_id: string;
  phone_number_id: string;
  access_token: string;
  token_expires_at: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  registration_pin: string | null;
  register_warning: string | null;
  connected_by: string | null;
  connected_at: string;
  updated_at: string;
};

export type OlxCategoryCacheRow = {
  vehicle_type: string;
  category_id: number;
  category_name: string;
  photos_limit: number;
  attributes: Json;
  fetched_at: string;
};

export type VisitStatus = "requested" | "confirmed" | "done" | "no_show" | "cancelled";

/** Uma viatura publicada que corresponde a um alerta de stock (0042). */
export type StockAlertMatchRow = {
  id: string;
  lead_id: string;
  car_id: string;
  status: "pending" | "sending" | "sent" | "manual" | "failed" | "cancelled";
  attempts: number;
  error: string | null;
  wa_message_id: string | null;
  sent_at: string | null;
  created_at: string;
};

/** Visitas ao stand e mensagens aos clientes (0042). Uma linha só. */
export type CustomerSettingsRow = {
  id: number;
  visits_enabled: boolean;
  visit_schedule: Json;
  customer_whatsapp: boolean;
  updated_at: string;
};

/** Interruptor geral dos avisos por WhatsApp (0036). Uma linha só. */
export type NotificationSettingsRow = {
  id: number;
  whatsapp_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
};

/** Um aviso que a pessoa mudou no perfil (0036). Sem linha = ligado. */
export type NotificationPreferenceRow = {
  profile_id: string;
  event: string;
  enabled: boolean;
  updated_at: string;
};

/** Um aviso por WhatsApp reclamado para envio (`claim_whatsapp_notifications`). */
export type WhatsAppNotificationClaimRow = {
  job_id: string;
  event_kind: string;
  subject: string;
  details: Record<string, unknown>;
  attempt: number;
  to_phone: string | null;
};

/** Atributos de uma categoria do OLX escolhida para alguma viatura (0031). */
export type OlxCategoryDetailsRow = {
  category_id: number;
  category_name: string;
  photos_limit: number;
  attributes: Json;
  fetched_at: string;
};

export type Database = {
  public: {
    Tables: {
      olx_connection: {
        Row: OlxConnectionRow;
        Insert: Partial<OlxConnectionRow> & { access_token: string; refresh_token: string; expires_at: string };
        Update: Partial<OlxConnectionRow>;
        Relationships: [];
      };
      olx_category_cache: {
        Row: OlxCategoryCacheRow;
        Insert: Partial<OlxCategoryCacheRow> & { vehicle_type: string; category_id: number };
        Update: Partial<OlxCategoryCacheRow>;
        Relationships: [];
      };
      olx_category_details: {
        Row: OlxCategoryDetailsRow;
        Insert: Partial<OlxCategoryDetailsRow> & { category_id: number };
        Update: Partial<OlxCategoryDetailsRow>;
        Relationships: [];
      };
      whatsapp_connection: {
        Row: WhatsAppConnectionRow;
        Insert: Partial<WhatsAppConnectionRow> & { waba_id: string; phone_number_id: string; access_token: string };
        Update: Partial<WhatsAppConnectionRow>;
        Relationships: [];
      };
      wa_messages: {
        Row: WaMessageRow;
        Insert: { wam_id: string; from_phone: string; actor_id?: string | null;
          received_at?: string; processed_at?: string | null;
          reply_sent_at?: string | null; last_error?: string | null };
        Update: { processed_at?: string | null; reply_sent_at?: string | null;
          actor_id?: string | null; last_error?: string | null };
        Relationships: [];
      };
      wa_pending_actions: {
        Row: WaPendingRow;
        Insert: { id?: string; actor_id: string; from_phone: string; kind: string;
          payload: Json; summary: string; expires_at?: string; status?: string };
        Update: { status?: string; settled_at?: string | null; result_id?: string | null;
          image_wamid?: string | null;
          // 0039: as fotografias que chegam depois juntam-se à mesma proposta.
          payload?: Json; summary?: string; expires_at?: string };
        Relationships: [];
      };
      wa_contacts: {
        Row: WaContactRow;
        Insert: Partial<WaContactRow> & { phone: string };
        Update: Partial<WaContactRow>;
        Relationships: [];
      };
      wa_media: {
        Row: WaMediaRow;
        Insert: { id?: string; from_phone: string; actor_id: string | null; media_id: string;
          storage_path: string; width?: number | null; height?: number | null;
          bytes?: number | null; caption?: string; status?: string };
        Update: { status?: string; settled_at?: string | null; car_media_id?: string | null };
        Relationships: [];
      };
      company_days: {
        Row: { id: string; day: string; kind: string; label: string };
        Insert: { id?: string; day: string; kind: string; label?: string };
        Update: { id?: string; day?: string; kind?: string; label?: string };
        Relationships: [];
      };
      leave_balances: {
        Row: {
          profile_id: string; year: number; base_days: number;
          carried_days: number; birthday_day: number; updated_at: string;
        };
        Insert: {
          profile_id: string; year: number; base_days?: number;
          carried_days?: number; birthday_day?: number; updated_at?: string;
        };
        Update: {
          profile_id?: string; year?: number; base_days?: number;
          carried_days?: number; birthday_day?: number; updated_at?: string;
        };
        Relationships: [];
      };
      leave_days: {
        Row: {
          id: string; profile_id: string; day: string; half: boolean;
          status: string; note: string; decided_by: string | null;
          decided_at: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; profile_id: string; day: string; half?: boolean;
          status?: string; note?: string; decided_by?: string | null;
          decided_at?: string | null;
        };
        Update: {
          half?: boolean; status?: string; note?: string;
          decided_by?: string | null; decided_at?: string | null;
        };
        Relationships: [];
      };
      lead_activities: Table<Activity, "lead_id" | "kind" | "body">;
      vehicle_financials: Table<Financials, "car_id">;
      vehicle_costs: Table<
        VehicleCost,
        "car_id" | "category" | "description" | "amount"
      >;
      preparation_tasks: Table<PreparationTask, "car_id" | "title">;
      reservations: Table<Reservation, "car_id" | "lead_id" | "expires_at">;
      audit_log: Table<AuditEntry>;
      notification_jobs: Table<NotificationJob>;
      stock_alert_matches: {
        Row: StockAlertMatchRow;
        Insert: { lead_id: string; car_id: string } & Partial<StockAlertMatchRow>;
        Update: Partial<StockAlertMatchRow>;
        Relationships: [];
      };
      customer_settings: {
        Row: CustomerSettingsRow;
        Insert: Partial<CustomerSettingsRow>;
        Update: Partial<CustomerSettingsRow>;
        Relationships: [];
      };
      notification_settings: {
        Row: NotificationSettingsRow;
        Insert: Partial<NotificationSettingsRow>;
        Update: Partial<NotificationSettingsRow>;
        Relationships: [];
      };
      notification_preferences: {
        Row: NotificationPreferenceRow;
        Insert: { profile_id: string; event: string; enabled?: boolean; updated_at?: string };
        Update: { enabled?: boolean; updated_at?: string };
        Relationships: [];
      };
      profiles: {
        Row: ProfilesRow;
        Insert: ProfilesInsert;
        Update: ProfilesUpdate;
        Relationships: [];
      };
      cars: {
        Row: CarsRow;
        Insert: CarsInsert;
        Update: CarsUpdate;
        Relationships: [];
      };
      car_media: {
        Row: CarMediaRowT;
        Insert: CarMediaInsert;
        Update: CarMediaUpdate;
        Relationships: [];
      };
      leads: {
        Row: LeadsRow;
        Insert: LeadsInsert;
        Update: LeadsUpdate;
        Relationships: [];
      };
      site_content: {
        Row: SiteContentRow;
        Insert: SiteContentInsert;
        Update: SiteContentUpdate;
        Relationships: [];
      };
      site_settings: {
        Row: SiteSettingsRow;
        Insert: SiteSettingsInsert;
        Update: SiteSettingsUpdate;
        Relationships: [];
      };
      testimonials: {
        Row: TestimonialsRow;
        Insert: TestimonialsInsert;
        Update: TestimonialsUpdate;
        Relationships: [];
      };
      car_views: {
        Row: CarViewsRow;
        Insert: CarViewsInsert;
        Update: CarViewsUpdate;
        Relationships: [];
      };
      integration_secrets: {
        Row: IntegrationSecretsRow;
        Insert: IntegrationSecretsInsert;
        Update: IntegrationSecretsUpdate;
        Relationships: [];
      };
      vehicle_tasks: {
        Row: VehicleTasksRow;
        Insert: VehicleTasksInsert;
        Update: VehicleTasksUpdate;
        Relationships: [];
      };
      time_entries: {
        Row: TimeEntriesRow;
        Insert: TimeEntriesInsert;
        Update: TimeEntriesUpdate;
        Relationships: [];
      };
      channel_listings: {
        Row: ChannelListingsRow;
        Insert: ChannelListingsInsert;
        Update: ChannelListingsUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      claim_notification_jobs: {
        Args: Record<string, never>;
        Returns: NotificationJob[];
      };
      prune_submission_limits: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      claim_whatsapp_notifications: {
        Args: { batch?: number };
        Returns: WhatsAppNotificationClaimRow[];
      };
      finish_whatsapp_notification: {
        Args: { job: string; outcome: string; detail?: string | null; message_id?: string | null };
        Returns: undefined;
      };
      queue_whatsapp_expiry_warning: { Args: Record<string, never>; Returns: number };
      queue_whatsapp_leave_upcoming: { Args: { agora?: string }; Returns: number };
      prune_notification_jobs: { Args: Record<string, never>; Returns: undefined };
      has_section: { Args: { section: string }; Returns: boolean };
      has_section_for: { Args: { uid: string; section: string }; Returns: boolean };
      has_vehicle_type_for: { Args: { uid: string; vtype: string }; Returns: boolean };
      normalize_phone: { Args: { raw: string }; Returns: string };
      prune_whatsapp: { Args: Record<string, never>; Returns: undefined };
      wa_actor_for_phone: { Args: { raw_phone: string }; Returns: string | null };
      /** Botões do aviso de visita: outcome 'confirm' | 'decline' → 'confirmed', 'declined', 'already_*', 'past', 'not_found'. */
      wa_set_visit: { Args: { actor: string; lead: string; outcome: string }; Returns: string };
      wa_vehicles_for_actor: { Args: { actor: string }; Returns: WaVehicleRow[] };
      wa_vehicle_summary: {
        Args: { actor: string; car: string };
        Returns: WaVehicleSummary | null;
      };
      wa_create_workshop_vehicle: {
        Args: { actor: string; vehicle_name: string; plate: string; selected_type: string };
        Returns: string;
      };
      wa_add_cost: {
        Args: { actor: string; car: string; kind: string; note: string;
          value: number; incurred: string };
        Returns: string;
      };
      wa_log_hours: {
        Args: { actor: string; car: string; work_day: string; starts: string;
          ends: string | null; note: string | null };
        Returns: string;
      };
      // ---- 0038: mais ordens por WhatsApp ----
      wa_leads_for_actor: {
        Args: { actor: string; search: string | null; only_status: string | null };
        Returns: WaLeadRow[];
      };
      wa_testimonials_for_actor: {
        Args: { actor: string; search: string | null; only_pending: boolean };
        Returns: WaTestimonialRow[];
      };
      wa_staff_for_actor: {
        Args: { actor: string; search: string };
        Returns: WaStaffRow[];
      };
      wa_create_draft_car: {
        Args: { actor: string; selected_type: string; vehicle_make: string;
          vehicle_model: string; vehicle_variant: string | null; vehicle_year: number;
          km: number; fuel_kind: string; gearbox: string; body_kind: string;
          asking_price: number | null; on_request: boolean; plate: string | null;
          paint: string | null; door_count: number; seat_count: number; slug_base: string };
        Returns: string;
      };
      wa_update_car: {
        Args: { actor: string; car: string; changes: Json };
        Returns: string;
      };
      wa_set_car_status: {
        Args: { actor: string; car: string; new_status: string };
        Returns: string;
      };
      wa_set_lead_status: {
        Args: { actor: string; lead: string; new_status: string; reason: string | null };
        Returns: string;
      };
      wa_assign_lead: {
        Args: { actor: string; lead: string; assignee: string };
        Returns: string;
      };
      wa_add_lead_note: {
        Args: { actor: string; lead: string; note_kind: string; note: string };
        Returns: string;
      };
      wa_set_testimonial: {
        Args: { actor: string; testimonial: string; publish: boolean };
        Returns: string;
      };
      // ---- 0039: fotografias por WhatsApp ----
      wa_add_car_media: {
        Args: { actor: string; car: string; items: Json };
        Returns: string;
      };
      prune_wa_media: { Args: { ids: string[] }; Returns: number };
      // 0040 — Página inicial e Definições por WhatsApp.
      wa_update_home: { Args: { actor: string; new_content: Json }; Returns: undefined };
      wa_update_showroom: { Args: { actor: string; new_content: Json }; Returns: undefined };
      wa_update_badges: { Args: { actor: string; new_content: Json }; Returns: undefined };
      wa_update_site_settings: { Args: { actor: string; changes: Json }; Returns: undefined };
      can_approve_leave: { Args: Record<string, never>; Returns: boolean };
      leave_directory: {
        Args: Record<string, never>;
        Returns: { id: string; full_name: string }[];
      };
      consume_submission: {
        Args: { key_value: string; max_hits: number; window_seconds: number };
        Returns: boolean;
      };
      create_workshop_intake_for_type: {
        Args: {vehicle_name:string;plate:string;selected_type:string};
        Returns:string;
      };
      mark_vehicle_prepared: {
        Args: { vehicle: string };
        Returns: undefined;
      };
      return_vehicle_to_workshop: {
        Args: { vehicle: string };
        Returns: undefined;
      };
      olx_category_fields: {
        Args: Record<string, never>;
        Returns: { vehicle_type: string; category_id: number; category_name: string; attributes: Json }[];
      };
      analytics_summary_by_type: {
        Args: {selected_type:string};
        Returns:AnalyticsSummary;
      };
      create_workshop_intake: {
        Args: { vehicle_name: string; plate: string };
        Returns: string;
      };
      reserve_vehicle: {
        Args: { lead: string; expiry: string; deposit: number };
        Returns: string;
      };
      release_reservation: {
        Args: { reservation_id: string };
        Returns: undefined;
      };
      confirm_reservation_deposit: {
        Args: { reservation_id: string };
        Returns: undefined;
      };
      expire_reservations: { Args: Record<string, never>; Returns: number };
      close_vehicle_sale: {
        Args: { lead: string; amount: number; sale_date: string };
        Returns: undefined;
      };
      erase_lead_personal_data: { Args: { lead: string }; Returns: string };
      car_has_sales_history: { Args: { car: string }; Returns: boolean };
      staff_directory: { Args: Record<string, never>; Returns: StaffMember[] };
      analytics_summary: {
        Args: Record<string, never>;
        Returns: AnalyticsSummary;
      };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      is_admin: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: {
      user_role: UserRole;
      fuel_type: FuelType;
      transmission: Transmission | null;
      body_type: BodyType;
      car_status: CarStatus;
      media_kind: MediaKind;
      lead_kind: LeadKind;
      lead_status: LeadStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type CarRow = CarsRow;
export type CarInsert = CarsInsert;
export type CarUpdate = CarsUpdate;
export type CarMediaRow = CarMediaRowT;
export type LeadRow = LeadsRow;
export type ProfileRow = ProfilesRow;
export type VehicleTaskRow = VehicleTasksRow;
export type TimeEntryRow = TimeEntriesRow;
export type ChannelListingRow = ChannelListingsRow;
export type ChannelListingInsert = ChannelListingsInsert;

/** Carro com a sua media (join usado nas queries). */
export type CarWithMedia = CarRow & { car_media: CarMediaRow[] };
