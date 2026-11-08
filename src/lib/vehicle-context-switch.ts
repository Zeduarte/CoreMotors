import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { cleanLocalRedirect } from "@/lib/local-redirect";
import { safePublicTarget } from "@/lib/safe-target";

/**
 * Troca o tipo de viatura (carros/motas) do SITE PÚBLICO, guardado num
 * cookie, e volta à página pedida. O backoffice já não tem esta troca: mostra
 * carros e motas juntos (filtro `?tipo=` em cada ecrã). Um pedido antigo com
 * `area=admin` é tratado como do site, sem tocar no backoffice.
 */
export async function switchVehicleContext(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = params.get("type");
  if (type !== "car" && type !== "motorcycle") {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }

  let target = params.get("target");
  // Vindo do redirecionamento de /inventario?tipo=… (next.config.mjs): o Next
  // juntou a pesquisa original a este pedido; volta ao stock com ela (sem o
  // `tipo`, que já fez o seu trabalho).
  if (params.get("carry") === "1" && target === "/inventario") {
    const rest = new URLSearchParams(params);
    for (const key of ["type", "area", "target", "carry", "tipo"]) rest.delete(key);
    const query = rest.toString();
    if (query) target = `${target}?${query}`;
  }
  const destination = safePublicTarget(target) ?? "/";
  // Sem a pesquisa deste pedido no endereço final (ver cleanLocalRedirect).
  const response = cleanLocalRedirect(destination, 303);
  response.cookies.set("coremotors_public_type", type, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
