import type { Metadata } from "next";
import Link from "next/link";

// O 404 das páginas do site lançado DENTRO do site: /carros/<filtro>,
// /motas/<filtro>, /carros e /motas de um tipo que o site não vende, e
// /servicos/<serviço>. Os layouts dessas rotas lançam o 404 antes do
// esqueleto (para o código ser 404 a sério), e o not-found de um segmento não
// apanha o que o próprio layout lança: fica aqui, dentro do cabeçalho e do
// rodapé. As fichas de viatura têm o seu em `viaturas/not-found.tsx`; um
// endereço que não existe de todo usa o de `app/not-found.tsx`.
export const metadata: Metadata = {
  title: "Página não encontrada",
  robots: { index: false, follow: true },
};

export default function PublicNotFound() {
  return (
    <div className="container-px flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <p className="eyebrow mb-6">Erro 404</p>
      <h1 className="text-headline font-semibold text-paper">Página não encontrada</h1>
      <p className="mt-4 max-w-md font-light text-paper/60">
        A página que procura não existe ou foi movida. Veja as viaturas que temos
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
