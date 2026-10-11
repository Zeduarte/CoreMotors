import type { Vehicle } from "@/types/vehicle";
import type { Company } from "@/lib/branding";
import { VehiclePrice } from "./VehiclePrice";
import { ContactButtons } from "./ContactButtons";

/** Só se mostra a partir daqui — "2 visitas" mais afasta do que convence. */
const MIN_VIEWS = 5;

/**
 * Cartão do preço, ao lado da galeria: preço, garantia e os dois caminhos
 * para falar connosco (pedir que liguem ou WhatsApp), logo no primeiro ecrã.
 */
export function PriceCard({
  vehicle,
  company,
  url,
  recentViews,
}: {
  vehicle: Vehicle;
  company: Company;
  url: string;
  recentViews: number | null;
}) {
  const status = vehicle.status ?? "published";
  const views =
    recentViews !== null && recentViews >= MIN_VIEWS && status !== "sold"
      ? recentViews
      : null;
  const warranty = vehicle.warrantyMonths
    ? `Garantia de ${vehicle.warrantyMonths} meses`
    : null;

  return (
    <div className="rounded-3xl bg-ink-soft p-5">
      <div className="flex items-center justify-between gap-4">
        <span className="text-lg font-medium text-paper/80">Preço de venda</span>
        <span className="text-3xl font-bold text-accent">
          <VehiclePrice vehicle={vehicle} />
        </span>
      </div>

      {(warranty || views) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-white/10 pt-3 text-xs">
          <span className="text-paper/55">
            {views && (
              <>
                <span aria-hidden>👀 </span>
                {views} visitas nos últimos 7 dias
              </>
            )}
          </span>
          {warranty && <span className="font-medium text-paper/80">{warranty}</span>}
        </div>
      )}

      <ContactButtons
        vehicleName={`${vehicle.make} ${vehicle.model} ${vehicle.year}`}
        url={url}
        status={status}
        company={company}
      />
    </div>
  );
}
