import type { VehicleType } from "@/lib/vehicle-categories";
import type { Section } from "@/lib/permissions";
import { TYPE_PATH, resolveSeoPage, seoPath } from "@/lib/seo-pages";

/**
 * Carros e motas são dois "mundos" com stock separado — mas nem tudo se
 * separa. Este módulo diz onde o mundo importa e onde é conteúdo comum, para
 * o seletor não aparecer em páginas onde não significa nada.
 */

/**
 * Páginas públicas iguais nos dois mundos (institucional, legal e o link de
 * cancelar o alerta de stock, que chega por WhatsApp/email).
 */
export const COMMON_PUBLIC_PATHS = [
  "/sobre",
  "/servicos",
  "/contactos",
  "/politica-de-cookies",
  "/politica-de-privacidade",
  "/termos-condicoes",
  "/alertas",
] as const;

/**
 * Separadores do backoffice que gerem o site inteiro, não um tipo de viatura:
 * testemunhos e utilizadores (pedido do cliente), definições, integrações e
 * plataformas de anúncios (configuração global) e as horas (pessoais).
 */
export const COMMON_ADMIN_SECTIONS: Section[] = [
  "testemunhos",
  "utilizadores",
  "definicoes",
  "integracoes",
  "anuncios",
  "horas",
];

/**
 * A área pessoal (dados e férias) não é um separador de permissões — está
 * fora de `Section` —, por isso tem de ser tratada à parte.
 */
const COMMON_ADMIN_PATHS = ["perfil"];

/** O mundo influencia o que esta página pública mostra? */
export function pathHasWorld(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return !COMMON_PUBLIC_PATHS.some(
    (p) => clean === p || clean.startsWith(`${p}/`),
  );
}

/** O mundo que o próprio endereço diz (/carros/…, /motas/…), ou null. */
export function worldFromPath(pathname: string): VehicleType | null {
  return /^\/carros(\/|$)/.test(pathname)
    ? "car"
    : /^\/motas(\/|$)/.test(pathname)
      ? "motorcycle"
      : null;
}

/**
 * Mostrar o ecrã de escolha (carros ou motas) a quem ainda não escolheu?
 *
 * Não nas páginas comuns aos dois mundos (escolher não muda nada — e tapava,
 * por exemplo, o link de cancelar o alerta), nem onde o endereço já diz o
 * mundo: as páginas por marca/categoria e a ficha de uma viatura (o tipo da
 * própria viatura, gravado por `VehicleWorldSync`), incluindo a ficha impressa.
 */
export function needsWorldChoice(pathname: string): boolean {
  return (
    pathHasWorld(pathname) &&
    !worldFromPath(pathname) &&
    !/^\/viaturas\/[^/]+/.test(pathname)
  );
}

/**
 * Para onde vai o seletor de mundo (para `target`) a partir desta página.
 *
 * Quase sempre a mesma página: o cookie muda e ela passa a mostrar o outro
 * mundo. Mas /carros/… e /motas/… dizem o mundo no próprio endereço — voltar
 * ao mesmo endereço parecia não fazer nada. Aí vai para a página equivalente
 * do outro mundo (/carros/bmw → /motas/bmw, se a marca também tem motas) ou,
 * não havendo, para a lista do outro mundo. Numa ficha de viatura o slug é do
 * mundo atual: vai para o stock.
 */
export function worldSwitchDestination(pathname: string, target: VehicleType): string {
  if (pathname.startsWith("/viaturas/")) return "/inventario";
  if (!worldFromPath(pathname)) return pathname;
  const list = `/${TYPE_PATH[target]}`;
  const slug = /^\/(?:carros|motas)\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (!slug) return list;
  const page = resolveSeoPage(target, decodeURIComponentSafe(slug), []);
  return page ? seoPath(page) : list;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** O mundo influencia este ecrã do backoffice? */
export function adminPathHasWorld(pathname: string): boolean {
  const section = pathname.split("/")[2] ?? "";
  if (COMMON_ADMIN_PATHS.includes(section)) return false;
  return !COMMON_ADMIN_SECTIONS.includes(section as Section);
}

export const WORLD_LABEL: Record<VehicleType, string> = {
  car: "carros",
  motorcycle: "motas",
};

/** O outro mundo — é para lá que o seletor aponta. */
export function otherWorld(type: VehicleType): VehicleType {
  return type === "car" ? "motorcycle" : "car";
}
