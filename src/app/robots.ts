import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/**
 * O backoffice e a API ficam fora dos motores de busca (o backoffice já tem
 * `noindex`, mas assim nem gastam visitas do Google). Os feeds dos portais
 * (/api/feeds/…) ficam abertos: há leitores de catálogos que seguem o
 * robots.txt (a regra mais comprida ganha).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/api/feeds/"], disallow: ["/admin", "/api/"] },
    sitemap: `${site.url}/sitemap.xml`,
  };
}
