import type { Metadata } from "next";
import { SeoListing, seoMetadata } from "@/components/seo/SeoListing";

// Página para o Google: todos os carros em stock, sem depender da escolha
// carros/motas guardada no browser.
export const revalidate = 300;

export function generateMetadata(): Promise<Metadata> {
  return seoMetadata("car", null);
}

export default function Page() {
  return <SeoListing type="car" slug={null} />;
}
