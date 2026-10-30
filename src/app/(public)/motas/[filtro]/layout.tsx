import { notFound } from "next/navigation";
import { seoPageExists } from "@/lib/route-guards";

/** Marca/categoria/preço desconhecidos → 404 a sério, antes do esqueleto. */
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ filtro: string }>;
}) {
  if (!(await seoPageExists("motorcycle", (await params).filtro))) notFound();
  return children;
}
