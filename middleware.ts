import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Só onde há sessão: o backoffice e as rotas que o servem. As páginas
  // públicas não precisam de sessão — correr isto em cada visita só as atrasava
  // e gastava créditos do Netlify.
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/olx/:path*",
    "/api/vehicle-context",
  ],
};
