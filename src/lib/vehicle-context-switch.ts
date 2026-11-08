import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { cleanLocalRedirect } from "@/lib/local-redirect";
import { safePublicTarget } from "@/lib/safe-target";

/**
 * Links antigos da troca carros/motas (`/api/vehicle-context?type=…&target=…`),
 * que ainda podem estar partilhados ou em favoritos. O site já não tem dois
 * «mundos»: carros e motas estão juntos. Vai para a página pedida sem guardar
 * nada; se for o stock, abre filtrado nesse tipo (`?tipo=carros|motas`).
 */
export async function switchVehicleContext(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = params.get("type");
  if (type !== "car" && type !== "motorcycle") {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }

  let target = safePublicTarget(params.get("target")) ?? "/";
  if (target.split("?")[0] === "/inventario") {
    const [, query = ""] = target.split("?");
    const rest = new URLSearchParams(query);
    // `carry=1` (redirecionamento antigo do next.config): a pesquisa veio junta.
    if (params.get("carry") === "1") {
      for (const [k, v] of params) if (!["type", "area", "target", "carry", "tipo"].includes(k)) rest.set(k, v);
    }
    rest.set("tipo", type === "motorcycle" ? "motas" : "carros");
    target = `/inventario?${rest}`;
  }
  const response = cleanLocalRedirect(target, 303);
  // O cookie da escolha antiga deixou de servir: apaga-se.
  response.cookies.set("coremotors_public_type", "", { path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
