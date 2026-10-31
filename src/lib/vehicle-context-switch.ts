import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedVehicleTypes } from "@/lib/vehicle-context";
import { cleanLocalRedirect, localRedirect } from "@/lib/local-redirect";
import { safePublicTarget } from "@/lib/safe-target";

const ADMIN_TARGETS = [
  "/admin", "/admin/carros", "/admin/carros/novo", "/admin/oficina",
  "/admin/leads/agenda",
  "/admin/financeiro", "/admin/leads", "/admin/integracoes", "/admin/anuncios",
  "/admin/pagina-inicial", "/admin/definicoes", "/admin/testemunhos",
  "/admin/utilizadores",
];
/**
 * Troca o tipo de viatura (carros/motas) guardado num cookie e volta à página
 * pedida. `/api/vehicle-context` serve o site e o backoffice (`area=admin`);
 * `/admin/vehicle-context` só o backoffice — dentro do âmbito da app instalada,
 * para a troca não abrir fora dela no iOS.
 */
export async function switchVehicleContext(request: NextRequest, forceArea?: "admin") {
  const params = request.nextUrl.searchParams;
  const type = params.get("type");
  const area = forceArea ?? (params.get("area") === "admin" ? "admin" : "public");
  if (type !== "car" && type !== "motorcycle") {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }

  // No backoffice o tipo é uma permissão, não uma preferência: quem só tem
  // acesso a carros não passa a ver motas escrevendo este URL à mão.
  if (area === "admin" && !(await getAllowedVehicleTypes()).includes(type)) {
    return NextResponse.json(
      { error: "Sem acesso a esse tipo de viatura." },
      { status: 403 },
    );
  }

  let target = params.get("target");
  // Vindo do redirecionamento de /inventario?tipo=… (next.config.mjs): o Next
  // juntou a pesquisa original a este pedido; volta ao stock com ela (sem o
  // `tipo`, que já fez o seu trabalho).
  if (area === "public" && params.get("carry") === "1" && target === "/inventario") {
    const rest = new URLSearchParams(params);
    for (const key of ["type", "area", "target", "carry", "tipo"]) rest.delete(key);
    const query = rest.toString();
    if (query) target = `${target}?${query}`;
  }
  const validTarget =
    area === "public"
      ? safePublicTarget(target)
      : target &&
        (ADMIN_TARGETS.includes(target) || /^\/admin\/carros\/[0-9a-f-]{36}$/.test(target))
        ? target
        : null;
  const destination = validTarget ?? (area === "admin" ? "/admin/carros" : "/");
  // Sem a pesquisa deste pedido no endereço final (ver cleanLocalRedirect);
  // /admin/vehicle-context (só backoffice) usa o redirecionamento simples.
  const response =
    forceArea ? localRedirect(destination, 303) : cleanLocalRedirect(destination, 303);
  response.cookies.set(`coremotors_${area}_type`, type, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
