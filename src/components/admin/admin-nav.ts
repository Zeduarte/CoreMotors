import type { Section } from "@/lib/permissions";
import type { AdminIconName } from "./AdminIcon";

export type AdminNavItem = {
  href: string;
  label: string;
  /** O nome curto, escrito por baixo do ícone na barra lateral. */
  short: string;
  icon: AdminIconName;
  exact: boolean;
  section: Section;
};

/** Os separadores do backoffice, para a barra lateral de ícones e para a pílula de atalhos. */
export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", short: "Dashboard", icon: "dashboard", exact: true, section: "dashboard" },
  { href: "/admin/carros", label: "Viaturas", short: "Viaturas", icon: "car", exact: false, section: "carros" },
  { href: "/admin/carros/novo", label: "Nova viatura", short: "Nova", icon: "plus", exact: true, section: "carros" },
  { href: "/admin/pagina-inicial", label: "Página inicial", short: "Página", icon: "layout", exact: false, section: "pagina-inicial" },
  { href: "/admin/leads", label: "Leads", short: "Leads", icon: "mail", exact: false, section: "leads" },
  { href: "/admin/leads/agenda", label: "Agenda de visitas", short: "Agenda", icon: "calendar", exact: false, section: "leads" },
  { href: "/admin/testemunhos", label: "Testemunhos", short: "Testemunhos", icon: "star", exact: false, section: "testemunhos" },
  { href: "/admin/integracoes", label: "Integrações", short: "Integrações", icon: "plug", exact: false, section: "integracoes" },
  { href: "/admin/anuncios", label: "Plataformas de anúncios", short: "Anúncios", icon: "layers", exact: false, section: "anuncios" },
  { href: "/admin/utilizadores", label: "Utilizadores", short: "Utilizadores", icon: "users", exact: false, section: "utilizadores" },
  { href: "/admin/definicoes", label: "Definições", short: "Definições", icon: "settings", exact: false, section: "definicoes" },
  { href: "/admin/financeiro", label: "Custos e margens", short: "Custos", icon: "euro", exact: false, section: "financeiro" },
  { href: "/admin/oficina", label: "Oficina", short: "Oficina", icon: "tool", exact: false, section: "oficina" },
  { href: "/admin/horas", label: "Horas", short: "Horas", icon: "clock", exact: false, section: "horas" },
];

/** A agenda vive debaixo de /admin/leads, mas é um separador à parte. */
export function isAdminNavActive(pathname: string, item: Pick<AdminNavItem, "href" | "exact">): boolean {
  return item.exact
    ? pathname === item.href
    : pathname.startsWith(item.href) &&
        !(item.href === "/admin/leads" && pathname.startsWith("/admin/leads/agenda")) &&
        !(item.href === "/admin/carros" && pathname === "/admin/carros/novo");
}

export type AdminNavGroup = {
  key: string;
  /** O nome curto, por baixo do ícone na barra lateral. */
  short: string;
  /** O título do painel que abre ao lado (ao clicar ou passar o rato). */
  label: string;
  icon: AdminIconName;
  /** Os separadores do grupo, pelo `href` de `ADMIN_NAV`. */
  hrefs: string[];
};

/**
 * Os separadores agrupados para a barra lateral: assim cabem todos no ecrã,
 * sem scroll. Um grupo com um só separador (visível para o utilizador) é um
 * link direto; com vários, abre um painel ao lado com todos.
 */
export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  { key: "dashboard", short: "Dashboard", label: "Dashboard", icon: "dashboard", hrefs: ["/admin"] },
  {
    key: "viaturas",
    short: "Viaturas",
    label: "Viaturas",
    icon: "car",
    hrefs: ["/admin/carros", "/admin/carros/novo", "/admin/oficina", "/admin/financeiro"],
  },
  { key: "leads", short: "Leads", label: "Leads", icon: "mail", hrefs: ["/admin/leads", "/admin/leads/agenda"] },
  {
    key: "marketing",
    short: "Marketing",
    label: "Site e anúncios",
    icon: "layout",
    hrefs: ["/admin/pagina-inicial", "/admin/testemunhos", "/admin/anuncios"],
  },
  { key: "equipa", short: "Equipa", label: "Equipa", icon: "users", hrefs: ["/admin/utilizadores", "/admin/horas"] },
  {
    key: "definicoes",
    short: "Definições",
    label: "Definições",
    icon: "settings",
    hrefs: ["/admin/definicoes", "/admin/integracoes"],
  },
];
