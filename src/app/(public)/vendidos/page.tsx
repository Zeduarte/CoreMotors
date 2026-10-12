import type { Metadata } from "next";
import Link from "next/link";
import { getSoldVehicleList } from "@/lib/queries";
import { VehicleCard } from "@/components/vehicle/VehicleCard";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Viaturas vendidas",
  description:
    "Histórico de viaturas já vendidas. Veja algumas das entregas que fizemos — prova da confiança de quem comprou connosco.",
};

export default async function SoldPage() {
  const vehicles = await getSoldVehicleList();

  return (
    <div className="container-px pb-24 pt-32 md:pt-40">
      <header className="mb-12 max-w-2xl">
        <p className="eyebrow mb-4">Já entregues</p>
        <h1 className="text-headline font-semibold text-paper">
          Viaturas vendidas
        </h1>
        <p className="mt-4 text-lg font-light text-paper/60">
          {vehicles.length > 0
            ? `${vehicles.length} ${vehicles.length === 1 ? "viatura já encontrou" : "viaturas já encontraram"} dono. Obrigado pela confiança.`
            : "Ainda não há vendas registadas para mostrar aqui."}
        </p>
      </header>

      {vehicles.length > 0 ? (
        <div className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 min-[1400px]:grid-cols-4">
          {vehicles.map((v) => (
            <VehicleCard key={v.slug} vehicle={v} sharedTransition={false} />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-white/10 bg-ink-muted/40 p-12 text-center">
          <p className="text-lg font-light text-paper/60">
            Assim que fizermos as primeiras entregas, aparecem aqui.
          </p>
          <Link
            href="/inventario"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3 text-sm font-semibold text-ink transition-transform hover:scale-[1.03]"
          >
            Ver stock disponível <span aria-hidden>→</span>
          </Link>
        </div>
      )}

      {vehicles.length > 0 && (
        <div className="mt-16">
          <Link
            href="/inventario"
            className="inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3 text-sm font-semibold text-ink transition-transform hover:scale-[1.03]"
          >
            Ver stock disponível <span aria-hidden>→</span>
          </Link>
        </div>
      )}
    </div>
  );
}
