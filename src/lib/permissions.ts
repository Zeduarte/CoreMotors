/**
 * Papéis e permissões do backoffice.
 *
 * Hierarquia: admin (3) > chefe (2) > vendedor (1).
 *  - Quem tem rank MAIOR pode gerir (editar papel + acessos) quem tem rank
 *    menor. Nunca se pode gerir alguém de rank igual ou superior.
 *  - Cada utilizador tem acesso a um conjunto de "separadores" (sections). O
 *    admin vê sempre todos. Para chefe/vendedor, os acessos vêm de
 *    `allowed_sections` (configurável por um superior) ou, se estiver vazio,
 *    dos defaults do papel.
 *  - Um gestor só pode conceder separadores a que ele próprio tem acesso.
 */

import { VEHICLE_TYPES, type VehicleType } from "@/lib/vehicle-categories";

export type Role = "admin" | "chefe" | "vendedor" | "mecanico";

export type Section =
  | "dashboard"
  | "carros"
  | "pagina-inicial"
  | "leads"
  | "testemunhos"
  | "integracoes"
  | "anuncios"
  | "utilizadores"
  | "definicoes"
  | "oficina"
  | "horas"
  | "financeiro"
  | "partilhas";

export const ROLE_RANK: Record<Role, number> = {
  admin: 3,
  chefe: 2,
  vendedor: 1,
  // O mecânico está fora da hierarquia comercial; rank 1 (gerível pelo admin).
  mecanico: 1,
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  chefe: "Chefe",
  vendedor: "Vendedor",
  mecanico: "Mecânico",
};

/** Separadores do backoffice (ordem do menu). */
export const SECTIONS: {
  key: Section;
  label: string;
  href: string;
  exact: boolean;
}[] = [
  { key: "dashboard", label: "Dashboard", href: "/admin", exact: true },
  { key: "carros", label: "Viaturas", href: "/admin/carros", exact: false },
  { key: "pagina-inicial", label: "Página inicial", href: "/admin/pagina-inicial", exact: false },
  { key: "leads", label: "Leads", href: "/admin/leads", exact: false },
  { key: "testemunhos", label: "Testemunhos", href: "/admin/testemunhos", exact: false },
  { key: "integracoes", label: "Integrações", href: "/admin/integracoes", exact: false },
  { key: "anuncios", label: "Plataformas de anúncios", href: "/admin/anuncios", exact: false },
  { key: "utilizadores", label: "Utilizadores", href: "/admin/utilizadores", exact: false },
  { key: "definicoes", label: "Definições", href: "/admin/definicoes", exact: false },
  { key: "financeiro", label: "Custos e margens", href: "/admin/financeiro", exact: false },
  { key: "oficina", label: "Oficina", href: "/admin/oficina", exact: false },
  { key: "horas", label: "Horas", href: "/admin/horas", exact: false },
  { key: "partilhas", label: "Partilhas no Facebook", href: "/admin/partilhas", exact: false },
];

export const ALL_SECTIONS: Section[] = SECTIONS.map((s) => s.key);

/** Acessos por defeito de cada papel (quando `allowed_sections` está vazio). */
export const DEFAULT_SECTIONS: Record<Role, Section[]> = {
  admin: ALL_SECTIONS,
  // «partilhas» também na BD (has_section_for, 0052): as listas têm de bater certo.
  chefe: ["dashboard", "carros", "pagina-inicial", "leads", "testemunhos", "financeiro", "partilhas"],
  vendedor: ["dashboard", "carros", "leads", "partilhas"],
  // O mecânico só tem a Oficina — nada de dashboard/leads/etc.
  mecanico: ["oficina"],
};

function isRole(x: string): x is Role {
  return (
    x === "admin" || x === "chefe" || x === "vendedor" || x === "mecanico"
  );
}

/** O Dashboard está sempre acessível (evita bloqueios/loops de redireção). */
export const ALWAYS: Section = "dashboard";

/**
 * As Horas são pessoais: toda a gente as tem (cada um regista as suas), por
 * isso não são um separador que se atribui em Utilizadores.
 */
export const PERSONAL: Section = "horas";

/** Separadores efetivos de um utilizador. Admin → todos. */
export function effectiveSections(
  role: string,
  allowed?: string[] | null,
): Section[] {
  if (role === "admin") return ALL_SECTIONS;
  // O mecânico é um caso especial: só a Oficina (e as suas Horas), sem forçar
  // o dashboard.
  if (role === "mecanico") return ["oficina", PERSONAL];
  const r: Role = isRole(role) ? role : "vendedor";
  const base =
    allowed && allowed.length
      ? ALL_SECTIONS.filter((s) => allowed.includes(s))
      : DEFAULT_SECTIONS[r];
  const withDashboard = base.includes(ALWAYS) ? base : [ALWAYS, ...base];
  return withDashboard.includes(PERSONAL) ? withDashboard : [...withDashboard, PERSONAL];
}

/** O utilizador tem acesso a um separador? */
export function canAccess(
  role: string,
  allowed: string[] | null | undefined,
  section: Section,
): boolean {
  return effectiveSections(role, allowed).includes(section);
}

/**
 * Tipos de viatura a que um utilizador acede no backoffice.
 *
 * `null`/vazio em `allowed` = sem restrição. O admin acede sempre aos dois —
 * é ele que atribui esta permissão, não faria sentido poder fechar-se fora.
 */
export function effectiveVehicleTypes(
  role: string,
  allowed?: string[] | null,
): VehicleType[] {
  if (role === "admin") return [...VEHICLE_TYPES];
  const picked = (allowed ?? []).filter((t): t is VehicleType =>
    (VEHICLE_TYPES as readonly string[]).includes(t),
  );
  return picked.length ? picked : [...VEHICLE_TYPES];
}

/** O utilizador pode trabalhar com este tipo de viatura? */
export function canAccessVehicleType(
  role: string,
  allowed: string[] | null | undefined,
  type: VehicleType,
): boolean {
  return effectiveVehicleTypes(role, allowed).includes(type);
}

/**
 * Quem pode decidir o plano de férias de outra pessoa.
 *
 * Segue a hierarquia do backoffice: rank estritamente superior. O
 * administrador é a exceção — está no topo, logo decide tudo, incluindo o
 * próprio plano.
 */
export function canDecideLeaveFor(
  approverRole: string,
  targetRole: string,
): boolean {
  // Não é `canManage`: essa impede um chefe de mexer no mecânico, porque lhe
  // gerir o papel e os acessos é outra conversa. Para férias basta estar
  // acima na hierarquia — senão as férias do mecânico ficavam à espera do
  // administrador.
  if (approverRole === "admin") return true;
  const a = isRole(approverRole) ? ROLE_RANK[approverRole] : 0;
  const t = isRole(targetRole) ? ROLE_RANK[targetRole] : 0;
  return a > t;
}

/**
 * O plano fica aprovado assim que é submetido? Só para quem não tem ninguém
 * acima — pedir aprovação a si próprio não faz sentido.
 */
export function leaveSelfApproves(role: string): boolean {
  return role === "admin";
}

/**
 * `manager` pode gerir (editar) `target`? Rank estritamente superior — com uma
 * exceção: outro administrador só é gerível pelo dono da conta, que também é
 * admin mas está acima dos restantes.
 */
export function canManage(
  managerRole: string,
  targetRole: string,
  managerIsOwner = false,
): boolean {
  if (targetRole === "admin") return managerRole === "admin" && managerIsOwner;
  if (targetRole === "mecanico" && managerRole !== "admin") return false;
  const m = isRole(managerRole) ? ROLE_RANK[managerRole] : 0;
  const t = isRole(targetRole) ? ROLE_RANK[targetRole] : 0;
  return m > t;
}

/**
 * Papéis que um gestor pode atribuir. O admin pode atribuir qualquer papel
 * (incluindo admin); os restantes só papéis de rank inferior ao seu.
 */
export function assignableRoles(managerRole: string): Role[] {
  if (managerRole === "admin")
    return ["admin", "chefe", "vendedor", "mecanico"];
  const m = isRole(managerRole) ? ROLE_RANK[managerRole] : 0;
  // O mecânico não é atribuível por não-admins (fora da hierarquia comercial).
  return (["admin", "chefe", "vendedor"] as Role[]).filter(
    (r) => ROLE_RANK[r] < m,
  );
}

/**
 * Papel pré-selecionado ao criar uma conta.
 *
 * Nunca o primeiro da lista: essa era "admin", e bastava não tocar no campo
 * para criar outro administrador sem intenção. Começa-se pelo papel com menos
 * poder e quem cria sobe-o de propósito, se for o caso.
 */
export function defaultAssignableRole(managerRole: string): Role | null {
  const roles = assignableRoles(managerRole);
  if (roles.length === 0) return null;
  return (
    roles.find((r) => r === "vendedor") ??
    roles.reduce((low, r) => (ROLE_RANK[r] < ROLE_RANK[low] ? r : low), roles[0]!)
  );
}
