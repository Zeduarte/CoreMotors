import { ADMIN_SW_HEADERS, ADMIN_SW_SOURCE } from "@/lib/admin-sw";

// O script não muda entre pedidos: gerado no build.
export const dynamic = "force-static";

/**
 * Service Worker do backoffice (`/admin/sw.js`). Uma rota, e não um ficheiro
 * em `public/`, para os cabeçalhos (sobretudo `Service-Worker-Allowed`)
 * chegarem ao browser também no Netlify. Fica fora do middleware de sessão
 * (ver middleware.ts).
 */
export function GET() {
  return new Response(ADMIN_SW_SOURCE, { headers: ADMIN_SW_HEADERS });
}
