import type { Metadata } from "next";
import { ErrorScreen } from "@/components/layout/ErrorScreen";
import { getBranding } from "@/lib/queries";

// Serve QUALQUER endereço que não existe (não só viaturas): título e texto
// genéricos, e fora do índice do Google. As fichas de viatura têm a sua
// mensagem própria em `viaturas/[slug]/not-found.tsx`.
export const metadata: Metadata = {
  title: "Página não encontrada",
  robots: { index: false, follow: true },
};

export default async function NotFound() {
  const branding = await getBranding();
  return (
    <ErrorScreen
      companyName={branding.companyName}
      logoUrl={branding.logoUrl}
      eyebrow="Erro 404"
      title="Página não encontrada"
      text="A página que procura não existe ou foi movida. Volte ao stock para ver o que temos disponível."
    />
  );
}
