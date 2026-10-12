import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";

/** Esqueleto do stock: título, barra de filtros e a grelha de cartões. */
export default function Loading() {
  return (
    <div role="status" aria-label="A carregar o stock" className="container-px pb-24 pt-10 md:pt-16">
      <Skeleton className="h-3 w-24 rounded-full" />
      <Skeleton className="mt-5 h-10 w-1/2 max-w-md rounded-xl md:h-14" />
      <Skeleton className="mt-8 h-14 w-full rounded-2xl" />
      <div className="mt-10 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 min-[1400px]:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
