import type { Metadata, ResolvingMetadata } from "next";
import { SeoListing, seoMetadata } from "@/components/seo/SeoListing";
import { Core3CategoryPage } from "@/components/themes/core3/Core3CategoryPage";
import { getSiteTheme } from "@/lib/site-theme-query";

// Página para o Google: todas as motas em stock (só se o site vender este tipo —
// ver layout.tsx).
export const revalidate = 300;

export function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return seoMetadata("motorcycle", null, parent);
}

// No Core3 é a página de stock do tipo (filtros e cartões); nos outros, a de SEO.
export default async function Page() {
  if ((await getSiteTheme()) === "core3") return <Core3CategoryPage kind="motas" />;
  return <SeoListing type="motorcycle" slug={null} />;
}
