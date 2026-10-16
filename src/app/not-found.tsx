import { ErrorScreen } from "@/components/layout/ErrorScreen";
import { getBranding } from "@/lib/queries";

export default async function NotFound() {
  const branding = await getBranding();
  return (
    <ErrorScreen
      companyName={branding.companyName}
      logoUrl={branding.logoUrl}
      eyebrow="Erro 404"
      title="Esta viatura já saiu do stand"
      text="A página que procura não existe ou foi movida. Volte ao stock para ver o que temos disponível."
    />
  );
}
