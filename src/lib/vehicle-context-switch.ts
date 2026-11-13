import "server-only";
import type { NextRequest } from "next/server";
import { cleanLocalRedirect } from "@/lib/local-redirect";
import { safePublicTarget } from "@/lib/safe-target";

const TIPO = { car: "carros", motorcycle: "motas" } as const;

/**
 * Destino do backoffice (`/admin…`) de um link antigo com `area=admin`. O
 * resto do caminho passa pelo mesmo validador dos destinos públicos: só
 * caminhos deste site, sem "//", esquemas, ".." nem a API.
 */
export function safeAdminTarget(target: string | null): string | null {
  if (!target || !/^\/admin(?=$|[/?])/.test(target)) return null;
  const rest = target.slice("/admin".length);
  const checked = safePublicTarget(rest.startsWith("/") ? rest : `/${rest}`);
  if (!checked) return null;
  return rest.startsWith("/") ? `/admin${checked}` : `/admin${checked.slice(1)}`;
}

/** Junta `tipo=carros|motas` à pesquisa de um caminho (substitui o que lá estiver). */
function withTipo(path: string, tipo: string, carried?: URLSearchParams): string {
  const [pathname, query = ""] = path.split("?");
  const rest = new URLSearchParams(query);
  if (carried) for (const [k, v] of carried) rest.set(k, v);
  rest.set("tipo", tipo);
  return `${pathname}?${rest}`;
}

/**
 * Links antigos da troca carros/motas (`/api/vehicle-context?type=…&target=…`),
 * que ainda podem estar partilhados ou em favoritos. O site já não tem dois
 * «mundos»: carros e motas estão juntos. Vai para a página pedida sem guardar
 * nada; se for o stock, abre filtrado nesse tipo (`?tipo=carros|motas`).
 *
 * - Sem destino (ou com um destino que não serve), vai para o stock desse tipo.
 * - Com `area=admin`, um destino do backoffice (`/admin/carros`) é respeitado,
 *   filtrado no tipo; o login do backoffice trata de quem não entrou.
 * - Um tipo desconhecido não dá erro a quem clicou: vai para o destino
 *   público (sem filtro) ou para a página inicial.
 */
export async function switchVehicleContext(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const raw = params.get("type");
  const type = raw === "car" || raw === "motorcycle" ? raw : null;
  const publicTarget = safePublicTarget(params.get("target"));
  const adminTarget = params.get("area") === "admin" ? safeAdminTarget(params.get("target")) : null;

  let target: string;
  if (!type) {
    target = adminTarget ?? publicTarget ?? "/";
  } else if (adminTarget) {
    target = withTipo(adminTarget, TIPO[type]);
  } else if (!publicTarget || publicTarget.split("?")[0] === "/inventario") {
    // `carry=1` (redirecionamento antigo do next.config): a pesquisa veio junta.
    const carried = new URLSearchParams();
    if (params.get("carry") === "1") {
      for (const [k, v] of params) if (!["type", "area", "target", "carry", "tipo"].includes(k)) carried.set(k, v);
    }
    target = withTipo(publicTarget ?? "/inventario", TIPO[type], carried);
  } else {
    target = publicTarget;
  }

  const response = cleanLocalRedirect(target, 303);
  // O cookie da escolha antiga deixou de servir: apaga-se.
  response.cookies.set("coremotors_public_type", "", { path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
