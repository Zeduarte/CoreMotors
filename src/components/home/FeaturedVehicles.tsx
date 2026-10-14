"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Vehicle } from "@/types/vehicle";
import { VehicleCard } from "@/components/vehicle/VehicleCard";
import { AnimatedText } from "@/components/ui/AnimatedText";

/**
 * «Viaturas em destaque» na homepage: carrossel horizontal com snap, setas e
 * pontos por baixo (um ponto por "página") e o botão «Mostrar todas as N
 * viaturas», para o visitante perceber que há mais stock além destas.
 *
 * Telemóvel: um cartão largo de cada vez, à largura do ecrã (passa-se com
 * o dedo, as setas ou os pontos). Desktop: 2 (md), 3 (lg) ou 4 por página.
 */
export function FeaturedVehicles({
  vehicles,
  total,
  eyebrow = "A nossa seleção",
  title = "Viaturas em destaque",
}: {
  vehicles: Vehicle[];
  /** Total de viaturas em stock — o número do botão «Mostrar todas». */
  total: number;
  eyebrow?: string;
  title?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);

  // Quantas páginas cabem e em qual estamos — recalculado ao deslizar e
  // quando o ecrã muda de tamanho.
  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const count = max <= 1 ? 1 : Math.ceil(el.scrollWidth / el.clientWidth - 0.05);
    setPages(count);
    setPage(max <= 1 ? 0 : Math.round((el.scrollLeft / max) * (count - 1)));
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure]);

  function goTo(target: number) {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const clamped = Math.max(0, Math.min(pages - 1, target));
    el.scrollTo({ left: pages > 1 ? (clamped / (pages - 1)) * max : 0, behavior: "smooth" });
  }

  const shown = vehicles.slice(0, 10);

  return (
    <section className="container-px py-16 md:py-24">
      <div className="mb-8 md:mb-10">
        <p className="eyebrow mb-3">{eyebrow}</p>
        <AnimatedText as="h2" className="text-3xl font-semibold text-paper md:text-4xl">
          {title}
        </AnimatedText>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-ink-soft p-12 text-center text-paper/50">
          Ainda não há anúncios publicados. Os novos aparecem aqui
          automaticamente.
        </p>
      ) : (
        <>
          <div
            ref={trackRef}
            className="-mx-6 flex snap-x snap-mandatory scroll-px-6 gap-4 overflow-x-auto scroll-smooth px-6 pb-4 [-ms-overflow-style:none] [scrollbar-width:none] md:-mx-8 md:scroll-px-8 md:gap-6 md:px-8 [&::-webkit-scrollbar]:hidden"
          >
            {shown.map((vehicle, i) => (
              <div
                key={vehicle.slug}
                className="w-full shrink-0 snap-start md:w-[calc((100%-1.5rem)/2)] lg:w-[calc((100%-3rem)/3)] min-[1400px]:w-[calc((100%-4.5rem)/4)]"
              >
                <VehicleCard vehicle={vehicle} priority={i < 3} />
              </div>
            ))}
          </div>

          {pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => goTo(page - 1)}
                disabled={page === 0}
                aria-label="Anterior"
                className="grid h-9 w-9 place-items-center rounded-full text-lg text-paper transition-opacity disabled:opacity-30"
              >
                ←
              </button>
              <div className="flex items-center gap-2.5">
                {Array.from({ length: pages }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => goTo(i)}
                    aria-label={`Página ${i + 1} de ${pages}`}
                    aria-current={i === page}
                    className={`h-2.5 rounded-full transition-all duration-300 ease-premium ${
                      i === page ? "w-6 bg-accent" : "w-2.5 bg-paper/40 hover:bg-paper/70"
                    }`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => goTo(page + 1)}
                disabled={page === pages - 1}
                aria-label="Seguinte"
                className="grid h-9 w-9 place-items-center rounded-full text-lg text-paper transition-opacity disabled:opacity-30"
              >
                →
              </button>
            </div>
          )}

          <div className="mt-10 flex justify-center">
            <Link
              href="/inventario"
              className="group inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3.5 text-sm font-semibold text-ink transition-transform duration-300 ease-premium hover:scale-[1.03]"
            >
              Mostrar todas as {total} viaturas
              <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
