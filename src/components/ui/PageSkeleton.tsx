import { Skeleton } from "./Skeleton";

/**
 * Esqueleto genérico de página (título, texto e blocos), para o `loading.tsx`
 * das páginas sem esqueleto próprio. Aparece logo no clique — o Next
 * pré-carrega-o com os links — enquanto o servidor gera a página nova; sem
 * ele a página antiga ficava parada e o site parecia não responder.
 *
 * Cada página tem o seu `loading.tsx` (em vez de um só no grupo `(public)`):
 * o pré-carregamento pára no primeiro esqueleto que encontra, e um no grupo
 * esconderia os da ficha e do stock, que têm a forma da página.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="A carregar" className="container-px pb-24 pt-10 md:pt-16">
      <Skeleton className="h-3 w-28 rounded-full" />
      <Skeleton className="mt-5 h-10 w-2/3 max-w-xl rounded-xl md:h-14" />
      <Skeleton className="mt-4 h-4 w-full max-w-2xl rounded-lg" />
      <Skeleton className="mt-2 h-4 w-4/5 max-w-xl rounded-lg" />
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}
