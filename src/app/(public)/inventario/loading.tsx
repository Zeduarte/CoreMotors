import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";

/** Esqueleto do stock: o topo com a foto, a barra de filtros e os cartões. */
export default function Loading() {
  return (
    <div role="status" aria-label="A carregar o stock" className="container-px pb-24 pt-6 md:pt-10">
      <Skeleton className="h-64 w-full rounded-3xl md:h-[19rem]" />
      <Skeleton className="mt-8 h-14 w-full rounded-2xl" />
      <div className="mt-10 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 min-[1400px]:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
