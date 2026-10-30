"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { formatKm, priceLabel } from "@/lib/format";
import { LISTING_STATUSES, FUEL_TYPES } from "@/lib/schemas";
import type {
  CarStatus,
  FuelType,
  Transmission,
} from "@/lib/supabase/database.types";
import {
  bulkDelete,
  bulkSetStatus,
  deleteCar,
  duplicateCar,
  setCarStatus,
  toggleFeatured,
} from "@/lib/actions/cars";
import { CAR_STATUS_LABEL } from "./StatusBadge";
import { brandOptions, sameBrand } from "@/lib/brand-name";
import { manualStatusOptions, UNSELL_CONFIRM } from "@/lib/car-status";

export interface CarListItem {
  vehicleType: "car" | "motorcycle";
  id: string;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  plate: string | null;
  price: number | null;
  priceOnRequest: boolean;
  mileage: number;
  fuel: FuelType | null;
  transmission: Transmission | null;
  status: CarStatus;
  featured: boolean;
  slug: string;
  cover: { src: string; alt: string };
  mediaCount: number;
  updatedAt: string;
}

type SortKey = "recent" | "price-desc" | "price-asc" | "year-desc";

export function CarsTable({ items, isAdmin = false }: { items: CarListItem[]; isAdmin?: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CarStatus | "">("");
  const [fuel, setFuel] = useState<FuelType | "">("");
  const [make, setMake] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  // Agrupado sem olhar a maiúsculas: anúncios antigos com "Bmw" caem na
  // mesma opção que os gravados como "BMW".
  const makes = useMemo(() => brandOptions(items.map((i) => i.make)), [items]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = items.filter((i) => {
      if (status && i.status !== status) return false;
      if (fuel && i.fuel !== fuel) return false;
      if (make && !sameBrand(i.make, make)) return false;
      if (
        term &&
        !`${i.make} ${i.model} ${i.variant ?? ""} ${i.year} ${i.plate ?? ""}`
          .toLowerCase()
          .includes(term)
      )
        return false;
      return true;
    });
    const sorters: Record<SortKey, (a: CarListItem, b: CarListItem) => number> = {
      recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      "price-desc": (a, b) => (b.price ?? 0) - (a.price ?? 0),
      "price-asc": (a, b) => (a.price ?? 0) - (b.price ?? 0),
      "year-desc": (a, b) => (b.year ?? 0) - (a.year ?? 0),
    };
    return [...list].sort(sorters[sort]);
  }, [items, q, status, fuel, make, sort]);

  const allSelected =
    filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  function toggleAll() {
    setSelected(
      allSelected ? new Set() : new Set(filtered.map((i) => i.id)),
    );
  }
  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, msg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message ?? msg);
      // Nas ações em lote o texto explica uma a uma o que ficou por fazer.
      else toast.error(res.error ?? "Ocorreu um erro.", { duration: 12000 });
    });
  }

  const selectedIds = [...selected];

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pesquisar marca, modelo, ano…"
          className="field h-10 flex-1 min-w-[180px]"
          aria-label="Pesquisar viaturas"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as CarStatus | "")}
          className="field h-10 w-auto"
          aria-label="Filtrar por estado"
        >
          <option value="">Todos os estados</option>
          {LISTING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CAR_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          value={make}
          onChange={(e) => setMake(e.target.value)}
          className="field h-10 w-auto"
          aria-label="Filtrar por marca"
        >
          <option value="">Todas as marcas</option>
          {makes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={fuel}
          onChange={(e) => setFuel(e.target.value as FuelType | "")}
          className="field h-10 w-auto"
          aria-label="Filtrar por combustível"
        >
          <option value="">Todos os combustíveis</option>
          {FUEL_TYPES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="field h-10 w-auto"
          aria-label="Ordenar"
        >
          <option value="recent">Mais recentes</option>
          <option value="price-desc">Preço ↓</option>
          <option value="price-asc">Preço ↑</option>
          <option value="year-desc">Ano ↓</option>
        </select>
      </div>

      {/* Barra de ações em lote */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
          <span className="font-medium text-paper">
            {selectedIds.length} selecionadas
          </span>
          <button
            className="btn-ghost h-9 px-4"
            disabled={pending}
            onClick={() =>
              run(
                () => bulkSetStatus(selectedIds, "published"),
                "Viaturas publicadas.",
              )
            }
          >
            Publicar
          </button>
          <button
            className="btn-ghost h-9 px-4"
            disabled={pending}
            onClick={() =>
              run(
                () => bulkSetStatus(selectedIds, "draft"),
                "Movidas para rascunho.",
              )
            }
          >
            Despublicar
          </button>
          <button
            className="h-9 rounded-full border border-red-500/40 px-4 text-red-300 hover:bg-red-500/10 disabled:opacity-60"
            disabled={pending}
            onClick={() => {
              if (
                confirm(
                  `Apagar ${selectedIds.length} viatura(s)? Esta ação é irreversível.`,
                )
              ) {
                // Só as que têm histórico de vendas ou reservas ficam: o resumo diz quais.
                run(() => bulkDelete(selectedIds), "Viaturas apagadas.");
                setSelected(new Set());
              }
            }}
          >
            Apagar
          </button>
          <button
            className="ml-auto text-xs text-paper/60 hover:text-paper"
            onClick={() => setSelected(new Set())}
          >
            Limpar seleção
          </button>
        </div>
      )}

      {/* Tabela */}
      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <p className="p-12 text-center text-sm text-paper/50">
            Nenhuma viatura corresponde aos filtros.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-paper/40">
                <tr>
                  <th className="w-10 p-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Selecionar tudo"
                      className="accent-[color:var(--accent)]"
                    />
                  </th>
                  <th className="p-3">Viatura</th>
                  <th className="p-3">Preço</th>
                  <th className="p-3">Km</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3 text-center">Destaque</th>
                  <th className="p-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((car) => (
                  <tr
                    key={car.id}
                    className={selected.has(car.id) ? "bg-accent/5" : ""}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(car.id)}
                        onChange={() => toggleOne(car.id)}
                        aria-label={`Selecionar ${car.make} ${car.model}`}
                        className="accent-[color:var(--accent)]"
                      />
                    </td>
                    <td className="p-3">
                      <Link
                        href={`/admin/carros/${car.id}`}
                        className="flex items-center gap-3 group"
                      >
                        <div className="relative h-11 w-16 shrink-0 overflow-hidden rounded-lg bg-ink-muted">
                          <Image
                            src={car.cover.src}
                            alt={car.cover.alt}
                            fill
                            sizes="64px"
                            className="object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-paper group-hover:text-accent">
                            {car.make} {car.model}
                          </p>
                          <p className="text-xs text-paper/50">
                            {car.year} · {car.fuel} · {car.mediaCount} media
                          </p>
                        </div>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap p-3 font-medium text-accent">
                      {priceLabel(car.price ?? 0, car.priceOnRequest)}
                    </td>
                    <td className="whitespace-nowrap p-3 text-paper/70">
                      {formatKm(car.mileage)}
                    </td>
                    <td className="p-3">
                      <select
                        value={car.status}
                        disabled={pending}
                        onChange={(e) => {
                          const next = e.target.value as CarStatus;
                          if (car.status === "sold" && !confirm(UNSELL_CONFIRM)) return;
                          run(() => setCarStatus(car.id, next), "Estado atualizado.");
                        }}
                        className="rounded-lg border border-white/10 bg-ink px-2 py-1 text-xs text-paper"
                        aria-label="Mudar estado"
                      >
                        {/* Vendida e reservada só pelo contacto do cliente. */}
                        {manualStatusOptions(car.status, isAdmin).map((s) => (
                          <option key={s} value={s}>
                            {CAR_STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        disabled={pending}
                        aria-pressed={car.featured}
                        aria-label="Alternar destaque"
                        onClick={() =>
                          run(
                            () => toggleFeatured(car.id, !car.featured),
                            car.featured
                              ? "Removido dos destaques."
                              : "Adicionado aos destaques.",
                          )
                        }
                        className={`text-lg transition-transform hover:scale-110 ${
                          car.featured ? "text-accent" : "text-paper/25"
                        }`}
                      >
                        {car.featured ? "★" : "☆"}
                      </button>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          prefetch={false}
            href={`/api/vehicle-context?area=public&type=${car.vehicleType}&target=${encodeURIComponent(`/viaturas/${car.slug}`)}`}
                          target="_blank"
                          className="rounded-lg px-2 py-1 text-xs text-paper/60 hover:bg-white/5 hover:text-paper"
                          title="Ver no site"
                        >
                          ↗
                        </Link>
                        <Link
                          href={`/admin/carros/${car.id}`}
                          className="rounded-lg px-2 py-1 text-xs text-paper/60 hover:bg-white/5 hover:text-paper"
                          title="Editar"
                        >
                          ✎
                        </Link>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => duplicateCar(car.id),
                              "Viatura duplicada (rascunho).",
                            )
                          }
                          className="rounded-lg px-2 py-1 text-xs text-paper/60 hover:bg-white/5 hover:text-paper"
                          title="Duplicar"
                        >
                          ⧉
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            if (
                              confirm(
                                `Apagar ${car.make} ${car.model}? Esta ação é irreversível.`,
                              )
                            )
                              run(() => deleteCar(car.id), "Viatura apagada.");
                          }}
                          className="rounded-lg px-2 py-1 text-xs text-red-400/70 hover:bg-red-500/10 hover:text-red-300"
                          title="Apagar"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
