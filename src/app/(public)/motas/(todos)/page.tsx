import type { Metadata } from "next";
import { SeoListing, seoMetadata } from "@/components/seo/SeoListing";

// Página para o Google: todas as motas em stock (só se o site vender este tipo —
// ver layout.tsx).
export const revalidate = 300;

export function generateMetadata(): Promise<Metadata> {
  return seoMetadata("motorcycle", null);
}

export default function Page() {
  return <SeoListing type="motorcycle" slug={null} />;
}
