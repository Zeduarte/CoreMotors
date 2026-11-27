import type { Vehicle } from "@/types/vehicle";
import { priceLabel, vehiclePriceLabel } from "@/lib/format";
import { isCampaign } from "@/lib/vehicle-categories";
/** O preço da viatura (com o anterior, em campanha); nas vendidas, «Vendido». */
export function VehiclePrice({ vehicle }: { vehicle: Vehicle }) {
  if (vehicle.status === "sold") return <span>{vehiclePriceLabel(vehicle)}</span>;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {isCampaign(vehicle) && (
        <del
          className="text-sm font-normal text-paper/50"
          aria-label="Preço anterior"
        >
          {priceLabel(vehicle.previousPrice!, false)}
        </del>
      )}
      <span>{vehiclePriceLabel(vehicle)}</span>
    </span>
  );
}
