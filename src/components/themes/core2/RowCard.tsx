"use client";

import Link from "next/link";
import type { Vehicle } from "@/types/vehicle";
import { FadeImage } from "@/components/ui/FadeImage";
import { VehiclePrice } from "@/components/vehicle/VehiclePrice";
import { setVehiclePreview } from "@/lib/vehicle-preview";
import { rowLines } from "@/themes/core2/ui";
import { Core2Icon } from "./icons";

/**
 * O cartão deitado de uma viatura (como na maqueta): no stock do Core2/Core3
 * no telemóvel, e nos destaques e no stock da página inicial do Core3 — a foto
 * pequena à esquerda; ao lado a marca, o modelo e o ano, duas linhas de dados,
 * o preço e a seta para a ficha.
 */
export function RowCard({ vehicle: v, sizes = "45vw" }: { vehicle: Vehicle; sizes?: string }) {
  const cover = v.images[0];
  const [line1, line2] = rowLines(v);
  return (
    <Link
      href={`/viaturas/${v.slug}`}
      // A foto à vista vai já para o esqueleto da ficha (ver loading.tsx).
      onClick={(e) => setVehiclePreview(v.slug, e.currentTarget.querySelector("img")?.currentSrc)}
      className="group flex min-h-[8.5rem] overflow-hidden rounded-xl border border-white/10 bg-ink-soft transition-colors duration-300 hover:border-white/25 focus-visible:border-accent focus-visible:outline-none"
    >
      <div className="site-dark relative w-[41%] shrink-0 overflow-hidden bg-ink-muted">
        {cover && (
          <FadeImage src={cover.src} alt={cover.alt || `${v.make} ${v.model}`} fill sizes={sizes} className="object-cover" />
        )}
        {v.status === "reserved" && (
          <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[0.7rem] font-semibold text-white">Reservado</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col px-3.5 py-3">
        <p className="text-[0.9rem] font-bold leading-tight">{v.make}</p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="text-[1.1rem] font-bold leading-tight">{v.model}</h3>
          {v.year ? (
            <span className="rounded-md border border-white/20 px-1.5 py-px text-[0.72rem] font-medium tabular-nums text-paper/85">{v.year}</span>
          ) : null}
        </div>
        <p className="mt-1.5 text-[0.78rem] leading-snug text-paper/65">
          {line1}
          <br />
          {line2}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {/* O preço como no Core (letra, peso e «12 450 €»), com a baixa de preço. */}
          <span className="whitespace-nowrap text-lg font-semibold text-accent">
            <VehiclePrice vehicle={v} />
          </span>
          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/20 text-accent">
            <Core2Icon name="arrow" className="h-4 w-4" strokeWidth={2.4} />
          </span>
        </div>
      </div>
    </Link>
  );
}
