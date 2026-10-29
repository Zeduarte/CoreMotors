import type { Metadata } from "next";
import Link from "next/link";

// Ficha de uma viatura que já não está publicada (vendida há muito, retirada,
// ou link antigo). Fica dentro do site (cabeçalho e rodapé) e leva ao stock.
export const metadata: Metadata = {
  title: "Viatura não encontrada",
  robots: { index: false, follow: true },
};

export default function VehicleNotFound() {
  return (
    <div className="container-px flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <p className="eyebrow mb-6">Erro 404</p>
      <h1 className="text-headline font-semibold text-paper">
        Esta viatura já saiu do stand
      </h1>
      <p className="mt-4 max-w-md font-light text-paper/60">
        O anúncio que procura já não está disponível. Veja as viaturas que temos
        agora em stock.
      </p>
      <Link
        href="/inventario"
        className="mt-8 rounded-full bg-accent px-8 py-3.5 text-sm font-semibold text-ink transition-transform duration-300 ease-premium hover:scale-[1.03]"
      >
        Ver stock
      </Link>
    </div>
  );
}
