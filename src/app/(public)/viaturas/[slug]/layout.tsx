import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { vehicleExists } from "@/lib/route-guards";

/**
 * O endereço canónico da ficha, sem query strings (links partilhados com
 * `?utm_…` ou `?from=…` contam como a mesma página). A ficha imprimível
 * (`/ficha`) tem `noindex` e herda o mesmo canónico.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { alternates: { canonical: `/viaturas/${encodeURIComponent(slug)}` } };
}

/** Viatura inexistente → 404 a sério, antes de o esqueleto ser enviado. */
export default async function VehicleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  if (!(await vehicleExists((await params).slug))) notFound();
  return children;
}
