import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Só onde há sessão: o backoffice e as rotas que o servem. As páginas
  // públicas não precisam de sessão — correr isto em cada visita só as atrasava
  // e gastava créditos do Netlify.
  // A app do backoffice (manifest e Service Worker) fica de fora: o browser
  // vai buscá-los sem sessão, e o login também tem de poder ser instalado. Os
  // ícones estão em /admin-icons/, fora do backoffice.
  matcher: [
    "/admin",
    "/admin/((?!manifest\\.webmanifest$|sw\\.js$).*)",
    "/api/admin/:path*",
    "/api/olx/:path*",
    "/api/vehicle-context",
  ],
};
