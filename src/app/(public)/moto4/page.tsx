import type { Metadata, ResolvingMetadata } from "next";
import { pageMetadata } from "@/components/seo/page-metadata";
import { Core3CategoryPage } from "@/components/themes/core3/Core3CategoryPage";

export const revalidate = 300;

export function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, {
    title: "Moto 4 em stock",
    path: "/moto4",
    description: "Moto 4 (quads e side-by-side) em stock, com filtros por marca, preço, ano e quilómetros.",
  });
}

export default function Page() {
  return <Core3CategoryPage kind="moto4" />;
}
