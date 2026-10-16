import type { Metadata } from "next";
import { SeoListing, seoMetadata } from "@/components/seo/SeoListing";

// /carros/<marca | categoria | ate-N-euros> — ver src/lib/seo-pages.ts.
export const revalidate = 300;

type Params = Promise<{ filtro: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return seoMetadata("car", (await params).filtro);
}

export default async function Page({ params }: { params: Params }) {
  return <SeoListing type="car" slug={(await params).filtro} />;
}
