import { getBranding } from "@/lib/queries";
import { site } from "@/lib/site";
import { adminManifest } from "@/lib/admin-pwa";

// O nome da empresa vem das Definições (cache `branding`); a cada pedido, para
// a mudança de nome chegar logo à app instalada.
export const dynamic = "force-dynamic";

/**
 * Manifest da app do backoffice (`/admin/manifest.webmanifest`). Fica fora do
 * middleware de sessão (ver middleware.ts): o browser vai buscá-lo sem
 * cookies, e o próprio login tem de poder ser instalado.
 */
export async function GET() {
  let companyName: string = site.name;
  try {
    companyName = (await getBranding()).companyName || site.name;
  } catch {
    /* sem Supabase: fica o nome por defeito */
  }

  return new Response(JSON.stringify(adminManifest(companyName)), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
