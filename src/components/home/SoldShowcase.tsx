import Link from "next/link";
import type { Vehicle } from "@/types/vehicle";
import { VehicleCard } from "@/components/vehicle/VehicleCard";
import { Reveal } from "@/components/ui/Reveal";

/**
 * Vitrine de viaturas já vendidas (prova social), logo a seguir à secção de
 * confiança. Mostra as últimas vendas e um botão para a lista completa
 * (`/vendidos`). Não renderiza nada se ainda não houver vendas.
 */
export function SoldShowcase({ vehicles }: { vehicles: Vehicle[] }) {
  if (vehicles.length === 0) return null;

  return (
    <section className="container-px py-24 md:py-32">
      <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="max-w-2xl">
          <p className="eyebrow mb-4">Já entregues</p>
          <h2 className="text-headline font-semibold text-paper">
            Viaturas que encontraram dono
          </h2>
          <p className="mt-4 text-lg font-light text-paper/60">
            Cada viatura vendida é uma história de confiança. Veja algumas das
            nossas entregas mais recentes.
          </p>
        </div>
        <Link
          href="/vendidos"
          className="hidden shrink-0 items-center gap-2 rounded-full border border-white/20 px-7 py-3 text-sm font-medium text-paper transition-colors hover:border-accent hover:text-accent md:inline-flex"
        >
          Ver todos os vendidos <span aria-hidden>→</span>
        </Link>
      </div>

      <Reveal
        stagger={0.08}
        className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 min-[1400px]:grid-cols-4"
      >
        {vehicles.map((v) => (
          <VehicleCard key={v.slug} vehicle={v} sharedTransition={false} />
        ))}
      </Reveal>

      {/* Botão para mobile (o do cabeçalho só aparece em ≥md). */}
      <div className="mt-12 md:hidden">
        <Link
          href="/vendidos"
          className="flex items-center justify-center gap-2 rounded-full border border-white/20 px-7 py-3 text-sm font-medium text-paper transition-colors hover:border-accent hover:text-accent"
        >
          Ver lista completa de vendidos <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}
