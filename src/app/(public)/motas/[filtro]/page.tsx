import type { Metadata } from "next";
import { SeoListing, seoMetadata } from "@/components/seo/SeoListing";

// /motas/<marca | categoria | ate-N-euros> — ver src/lib/seo-pages.ts.
export const revalidate = 300;

type Params = Promise<{ filtro: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return seoMetadata("motorcycle", (await params).filtro);
}

export default async function Page({ params }: { params: Params }) {
  return <SeoListing type="motorcycle" slug={(await params).filtro} />;
}
