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
