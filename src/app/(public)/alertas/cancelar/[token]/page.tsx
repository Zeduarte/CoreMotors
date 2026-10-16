import type { Metadata } from "next";
import Link from "next/link";
import { verifyAlertCancelToken } from "@/lib/alert-token";
import { CancelAlertButton } from "./CancelAlertButton";

export const metadata: Metadata = {
  title: "Cancelar alerta de stock",
  robots: { index: false, follow: false },
};

/**
 * O link «cancelar o alerta» das mensagens de WhatsApp. Abrir a página não
 * cancela nada (as pré-visualizações de links abrem-na sozinhas): é preciso
 * carregar no botão.
 */
export default async function CancelAlertPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = Boolean(verifyAlertCancelToken(token));
  return (
    <div className="container-px flex min-h-[60vh] items-center justify-center py-24">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-soft p-8 text-center">
        <h1 className="text-2xl font-semibold text-paper">Cancelar alerta de stock</h1>
        {valid ? (
          <>
            <p className="mt-3 text-sm text-paper/65">
              Deixa de receber avisos quando entrarem viaturas compatíveis com o que procurava. Pode criar outro alerta
              quando quiser, no nosso stock.
            </p>
            <CancelAlertButton token={token} />
          </>
        ) : (
          <p className="mt-3 text-sm text-paper/65">Este link não é válido. Se quiser cancelar o alerta, contacte-nos.</p>
        )}
        <Link href="/inventario" className="mt-6 inline-block text-sm text-accent hover:underline">
          Ver o stock →
        </Link>
      </div>
    </div>
  );
}
