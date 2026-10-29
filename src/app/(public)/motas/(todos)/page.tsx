import type { Metadata } from "next";
import { SeoListing, seoMetadata } from "@/components/seo/SeoListing";

// Página para o Google: todos os motas em stock, sem depender da escolha
// carros/motas guardada no browser.
export const revalidate = 300;

export function generateMetadata(): Promise<Metadata> {
  return seoMetadata("motorcycle", null);
}

export default function Page() {
  return <SeoListing type="motorcycle" slug={null} />;
}
