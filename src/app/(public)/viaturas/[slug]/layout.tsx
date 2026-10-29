import type { Metadata } from "next";

/**
 * Só metadata: o endereço canónico da ficha, sem query strings (links
 * partilhados com `?utm_…` ou `?from=…` contam como a mesma página). A ficha
 * imprimível (`/ficha`) tem `noindex` e herda o mesmo canónico.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { alternates: { canonical: `/viaturas/${encodeURIComponent(slug)}` } };
}

export default function VehicleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
