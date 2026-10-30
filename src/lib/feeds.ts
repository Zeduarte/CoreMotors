import type { Company } from "@/lib/branding";
import type { Vehicle } from "@/types/vehicle";
import { mapAttributes, type OlxAttributeDef } from "@/lib/olx/attributes";

/**
 * Feeds de exportação do stock (XML genérico, XML do OLX e CSV). Funções PURAS;
 * a rota `/api/feeds/[platform]` só lê os dados e escolhe o formato.
 */

/**
 * Caracteres que o XML 1.0 não admite em lado nenhum (nem escapados, nem em
 * CDATA): controlos C0 exceto tab/LF/CR, U+FFFE/U+FFFF e surrogates soltos.
 * Uma descrição colada do Word com um destes partia o feed inteiro.
 */
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function xmlSafe(s: string): string {
  return (s ?? "").replace(XML_ILLEGAL, "");
}

export function esc(s: string): string {
  return xmlSafe(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Envolve texto em CDATA de forma segura (fecha/reabre em "]]>"). */
export function cdata(s: string): string {
  return `<![CDATA[${xmlSafe(s).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

/** As fotos por publicar usam um caminho do site (`/placeholder-car.svg`). */
const absolute = (base: string, src: string) => (src.startsWith("/") ? `${base}${src}` : src);
const vehicleUrl = (base: string, v: Vehicle) => `${base}/viaturas/${v.slug}`;

export function toXml(vehicles: Vehicle[], channelLabel: string, base: string): string {
  const items = vehicles
    .map((v) => {
      const title = `${v.make} ${v.model}${v.variant ? " " + v.variant : ""}`;
      const images = v.images
        .map((img) => `      <image>${esc(absolute(base, img.src))}</image>`)
        .join("\n");
      return `    <vehicle>
      <id>${esc(v.id ?? v.slug)}</id>
      <url>${esc(vehicleUrl(base, v))}</url>
      <make>${esc(v.make)}</make>
      <model>${esc(v.model)}</model>
      <version>${esc(v.variant ?? "")}</version>
      <title>${esc(title)}</title>
      <year>${v.year}</year>
      <price currency="EUR">${v.priceOnRequest ? "" : v.price}</price>
      <price_on_request>${v.priceOnRequest ? "true" : "false"}</price_on_request>
      <mileage unit="km">${v.mileage}</mileage>
      <fuel>${esc(v.fuel)}</fuel>
      <transmission>${esc(v.transmission)}</transmission>
      <body>${esc(v.body)}</body>
      <power unit="cv">${v.power}</power>
      <displacement unit="cc">${v.displacement}</displacement>
      <doors>${v.doors}</doors>
      <seats>${v.seats}</seats>
      <color>${esc(v.color ?? "")}</color>
      <description>${esc(v.description ?? "")}</description>
${images}
    </vehicle>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<listings generator="Supermotas" channel="${esc(channelLabel)}" generated="${new Date().toISOString()}">
${items}
</listings>`;
}

/** Categoria padrão do OLX de cada tipo, tal como o site a guardou ao ligar a conta. */
export interface OlxCategoryFields {
  vehicle_type: string;
  category_id: number;
  category_name: string;
  attributes: unknown;
}

/** Sem categoria do OLX guardada: o nome da secção do tipo de viatura. */
const FALLBACK_CATEGORY: Record<"car" | "motorcycle", string> = { car: "Carros", motorcycle: "Motos" };

/**
 * Feed no formato do OLX (<offers>/<offer>).
 *
 * A categoria e os atributos vêm da categoria que o site já escolheu e guardou
 * para cada tipo (`olx_category_fields`, a mesma da publicação pela API): os
 * códigos e os valores são os do próprio OLX, escolhidos por `mapAttributes`.
 * Sem essa informação (OLX ainda por ligar), a categoria fica só com o nome
 * do tipo (carros ou motas) e os atributos ficam de fora — não se inventam
 * códigos que o OLX pode não reconhecer.
 */
export function toOlxXml(
  vehicles: Vehicle[],
  company: Company,
  base: string,
  categories: OlxCategoryFields[] = [],
): string {
  const offers = vehicles
    .map((v) => {
      const type = v.vehicleType === "motorcycle" ? "motorcycle" : "car";
      const category = categories.find((c) => c.vehicle_type === type);
      const title = `${v.make} ${v.model}${v.variant ? " " + v.variant : ""} ${v.year}`;
      const images = v.images
        .map((img) => `        <image url="${esc(absolute(base, img.src))}"/>`)
        .join("\n");
      const price = v.priceOnRequest
        ? `    <price on_request="true"/>`
        : `    <price currency="EUR">${v.price}</price>`;

      const defs = Array.isArray(category?.attributes) ? (category.attributes as OlxAttributeDef[]) : [];
      const { attributes } = defs.length
        ? mapAttributes(defs, {
            make: v.make,
            model: v.model,
            year: v.year,
            mileage: v.mileage,
            fuel: v.fuel,
            transmission: v.transmission,
            body: v.body,
            power: v.power,
            displacement: v.displacement,
            color: v.color || null,
            doors: v.doors,
            seats: v.seats,
            registrationMonth: v.registrationMonth ?? null,
          })
        : { attributes: [] };
      const attributesXml = attributes.length
        ? `    <attributes>
${attributes
  .flatMap((a) => (a.values ?? [a.value ?? ""]).map((value) => `      <attribute code="${esc(a.code)}">${cdata(value)}</attribute>`))
  .join("\n")}
    </attributes>\n`
        : "";
      const categoryXml = category
        ? `    <category id="${category.category_id}">${cdata(category.category_name)}</category>`
        : `    <category>${FALLBACK_CATEGORY[type]}</category>`;

      return `  <offer>
    <id>${esc(v.id ?? v.slug)}</id>
    <url>${esc(vehicleUrl(base, v))}</url>
    <title>${cdata(title)}</title>
    <description>${cdata(v.description ?? "")}</description>
${categoryXml}
    <condition>usado</condition>
${price}
    <contact>
      <phone>${esc(company.phone)}</phone>
      <email>${esc(company.email)}</email>
    </contact>
    <location>
      <city>${esc(company.address.city)}</city>
      <postcode>${esc(company.address.postalCode)}</postcode>
    </location>
${attributesXml}    <images>
${images}
    </images>
  </offer>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<offers generator="Supermotas" generated="${new Date().toISOString()}">
${offers}
</offers>`;
}

export function toCsv(vehicles: Vehicle[], base: string): string {
  const header = [
    "id",
    "url",
    "make",
    "model",
    "version",
    "year",
    "price",
    "price_on_request",
    "mileage",
    "fuel",
    "transmission",
    "body",
    "power",
    "color",
    "image",
  ];
  const cell = (s: string | number) => `"${xmlSafe(String(s)).replace(/"/g, '""')}"`;
  const rows = vehicles.map((v) =>
    [
      v.id ?? v.slug,
      vehicleUrl(base, v),
      v.make,
      v.model,
      v.variant ?? "",
      v.year,
      v.priceOnRequest ? "" : v.price,
      v.priceOnRequest ? "sim" : "nao",
      v.mileage,
      v.fuel,
      v.transmission,
      v.body,
      v.power,
      v.color ?? "",
      v.images[0] ? absolute(base, v.images[0].src) : "",
    ]
      .map(cell)
      .join(","),
  );
  return [header.map(cell).join(","), ...rows].join("\n");
}
