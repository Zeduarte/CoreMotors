import { adminManifest } from "@/lib/admin-pwa";

// O nome da app é fixo (ADMIN_APP_NAME): não depende das Definições.
export const dynamic = "force-static";

/**
 * Manifest da app do backoffice (`/admin/manifest.webmanifest`). Fica fora do
 * middleware de sessão (ver middleware.ts): o browser vai buscá-lo sem
 * cookies, e o próprio login tem de poder ser instalado.
 */
export function GET() {
  return new Response(JSON.stringify(adminManifest()), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
