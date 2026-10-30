/**
 * Colunas que o site público lê com a chave anónima.
 *
 * A migração 0045 tira ao papel `anon` o acesso à tabela inteira e devolve-o
 * coluna a coluna: a matrícula, o autor e a categoria do OLX deixam de sair
 * pela API pública. Um `select("*")` com a chave anónima passa a falhar
 * («permission denied»), por isso as leituras públicas pedem sempre estas
 * listas. Antes da 0045 continuam a funcionar (o `anon` ainda vê tudo).
 *
 * Mudar uma lista obriga a mudar a 0045 (ou uma migração nova) com o mesmo
 * `grant select (...)` — o teste `tests/security.test.mjs` compara as duas.
 */

/** Viaturas: tudo menos `license_plate`, `created_by` e `olx_category_id`. */
export const PUBLIC_CAR_COLUMNS = [
  "id",
  "slug",
  "make",
  "model",
  "variant",
  "year",
  "mileage",
  "fuel",
  "transmission",
  "body",
  "power",
  "displacement",
  "color",
  "doors",
  "seats",
  "price",
  "price_on_request",
  "status",
  "featured",
  "tagline",
  "description",
  "extras",
  "location",
  "highlights",
  "published_at",
  "sold_at",
  "created_at",
  "updated_at",
  "previous_price",
  "national",
  "owners",
  "first_owner",
  "service_book",
  "warranty_months",
  "last_inspection",
  // Os portais onde o anúncio está (os feeds filtram por esta coluna).
  "channels",
  "registration_month",
  "vehicle_type",
  "point_of_sale_id",
  // Valores dos campos do OLX: alimentam os filtros da pesquisa pública.
  "olx_attributes",
  "badges",
] as const;

/** Viatura com as fotografias, para os cartões e a ficha pública. */
export const PUBLIC_CAR_SELECT = `${PUBLIC_CAR_COLUMNS.join(", ")}, car_media(*)`;

/** Definições do site: tudo menos `workshop_hourly_rate` (custo interno). */
export const PUBLIC_SITE_SETTINGS_COLUMNS = [
  "id",
  "company_name",
  "logo_url",
  "tagline",
  "accent",
  "accent_soft",
  "updated_at",
  "ga4_id",
  "pixel_id",
  "reservation_enabled",
  "deposit_amount",
  "phone",
  "email",
  "whatsapp",
  "address_street",
  "address_city",
  "address_postal",
  "address_country",
  "hours",
  "geo_lat",
  "geo_lng",
  "messenger",
] as const;
