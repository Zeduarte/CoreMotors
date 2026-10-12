import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Esqueleto da página inicial: o topo escuro com o título e a pesquisa.
 * Aparece logo no clique (o Next pré-carrega-o com os links) enquanto o
 * servidor gera a página. A página inicial vive no grupo `(home)` só para ter
 * este esqueleto sem o impor às outras páginas.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="A carregar" className="relative h-[calc(100svh-4rem)] bg-ink-soft md:h-dvh">
      <div className="container-px flex h-full flex-col items-center justify-center gap-5 max-md:justify-between max-md:pb-[5.75rem] max-md:pt-6">
        <div className="flex w-full flex-col items-center gap-4">
          <Skeleton className="h-3 w-40 rounded-full" />
          <Skeleton className="h-10 w-4/5 max-w-3xl rounded-xl md:h-20" />
          <Skeleton className="h-10 w-3/5 max-w-2xl rounded-xl md:h-20" />
        </div>
        <Skeleton className="h-36 w-full max-w-4xl rounded-xl md:mt-10 md:h-14" />
      </div>
    </div>
  );
}
