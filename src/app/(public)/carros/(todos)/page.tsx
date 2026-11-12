import type { Metadata } from "next";
import { SeoListing, seoMetadata } from "@/components/seo/SeoListing";

// Página para o Google: todos os carros em stock (só se o site vender este tipo —
// ver layout.tsx).
export const revalidate = 300;

export function generateMetadata(): Promise<Metadata> {
  return seoMetadata("car", null);
}

export default function Page() {
  return <SeoListing type="car" slug={null} />;
}
