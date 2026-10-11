import type { ReactNode } from "react";

/** Só se mostra a partir daqui — "2 visitas" mais afasta do que convence. */
const MIN_VIEWS = 5;

/** As visitas só se mostram a partir de `MIN_VIEWS` e nunca numa vendida. */
export function visibleViews(recentViews: number | null, status: string): number | null {
  return recentViews !== null && recentViews >= MIN_VIEWS && status !== "sold" ? recentViews : null;
}

/** Preço de venda, com a garantia e as visitas da semana por baixo. */
export function PriceSummary({
  price,
  warrantyMonths,
  views,
}: {
  price: ReactNode;
  warrantyMonths?: number | null;
  views: number | null;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <span className="text-lg font-medium text-paper/80">Preço de venda</span>
        <span className="text-3xl font-bold text-accent">{price}</span>
      </div>
      {(warrantyMonths || views) && (
        <p className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
          <span className="text-paper/55">
            {views && (
              <>
                <span aria-hidden>👀 </span>
                {views} visitas nos últimos 7 dias
              </>
            )}
          </span>
          {warrantyMonths ? (
            <span className="font-medium text-paper/80">Garantia de {warrantyMonths} meses</span>
          ) : null}
        </p>
      )}
    </>
  );
}
