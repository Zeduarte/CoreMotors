/**
 * Bloco cinzento de "a carregar", para os esqueletos das páginas
 * (`loading.tsx`). Pulsa devagar; com "reduzir movimento" fica parado.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`rounded-2xl bg-white/[0.06] motion-safe:animate-pulse ${className}`} />;
}

/** Cartão de viatura (foto + nome + preço), como no stock. */
export function CardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[4/3] rounded-3xl" />
      <Skeleton className="mt-4 h-5 w-3/4 rounded-lg" />
      <Skeleton className="mt-2 h-4 w-1/2 rounded-lg" />
      <Skeleton className="mt-4 h-6 w-1/3 rounded-lg" />
    </div>
  );
}
