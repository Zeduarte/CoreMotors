import { NextRequest, NextResponse } from "next/server";
import { getAllowedVehicleTypes } from "@/lib/vehicle-context";
import { localRedirect } from "@/lib/local-redirect";

const ADMIN_TARGETS = [
  "/admin", "/admin/carros", "/admin/carros/novo", "/admin/oficina",
  "/admin/leads/agenda",
  "/admin/financeiro", "/admin/leads", "/admin/integracoes", "/admin/anuncios",
  "/admin/pagina-inicial", "/admin/definicoes", "/admin/testemunhos",
  "/admin/utilizadores",
];
const PUBLIC_TARGETS = [
  "/", "/inventario", "/vendidos", "/favoritos", "/quiz", "/vender",
  "/contactos", "/sobre", "/servicos", "/comparar",
  "/politica-de-cookies", "/politica-de-privacidade", "/termos-condicoes",
];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = params.get("type");
  const area = params.get("area") === "admin" ? "admin" : "public";
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

  const target = params.get("target");
  const allowed = area === "admin" ? ADMIN_TARGETS : PUBLIC_TARGETS;
  const validTarget = target && (
    allowed.includes(target) ||
    (area === "public" && /^\/viaturas\/[a-z0-9-]+$/.test(target)) ||
    // Páginas por marca e categoria (/motas/yamaha).
    (area === "public" && /^\/(carros|motas)(\/[a-z0-9-]{1,80})?$/.test(target)) ||
    // O stock com uma pesquisa (vinda das páginas por marca, por exemplo).
    (area === "public" && /^\/inventario\?[A-Za-z0-9_%=&.+-]{1,500}$/.test(target)) ||
    (area === "admin" && /^\/admin\/carros\/[0-9a-f-]{36}$/.test(target))
  );
  const destination = validTarget ? target : area === "admin" ? "/admin/carros" : "/";
  const response = localRedirect(destination, 303);
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
