"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Vehicle } from "@/types/vehicle";
import { VehicleCard } from "@/components/vehicle/VehicleCard";
import { useLocalList, FAVORITES_KEY } from "@/hooks/useLocalList";

/**
 * Lista de favoritos. Recebe todas as viaturas publicadas do servidor e filtra
 * pelos slugs guardados no `localStorage` do dispositivo — a lista é privada e
 * nunca chega ao servidor. Preserva a ordem em que foram adicionadas.
 */
export function FavoritesList({ vehicles }: { vehicles: Vehicle[] }) {
  const { items, ready, clear } = useLocalList(FAVORITES_KEY);

  const bySlug = useMemo(
    () => new Map(vehicles.map((v) => [v.slug, v])),
    [vehicles],
  );
  const favorites = useMemo(
    () => items.map((slug) => bySlug.get(slug)).filter((v): v is Vehicle => Boolean(v)),
    [items, bySlug],
  );

  // Evita "flash" de estado vazio antes da hidratação do localStorage.
  if (!ready) {
    return <div className="min-h-[40vh]" aria-hidden />;
  }

  if (favorites.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-ink-soft p-12 text-center">
        <p className="text-4xl">🤍</p>
        <p className="mt-4 text-lg font-semibold text-paper">
          Ainda não guardou nenhuma viatura
        </p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-paper/50">
          Toque no coração numa viatura para a guardar aqui e comparar mais
          tarde — mesmo sem conta.
        </p>
        <Link
          href="/inventario"
          className="mt-6 inline-block rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink"
        >
          Explorar o stock
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <p className="text-sm text-paper/60">
          {favorites.length}{" "}
          {favorites.length === 1 ? "viatura guardada" : "viaturas guardadas"}
        </p>
        <button
          type="button"
          onClick={clear}
          className="text-sm text-paper/50 transition-colors hover:text-rose-300"
        >
          Limpar tudo
        </button>
      </div>
      <div className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 min-[1400px]:grid-cols-4">
        {favorites.map((v) => (
          <VehicleCard key={v.slug} vehicle={v} />
        ))}
      </div>
    </div>
  );
}
