"use client";

import { useParams } from "next/navigation";
import { Skeleton } from "@/components/ui/Skeleton";
import { ViewTransition } from "@/components/ui/ViewTransition";
import { vehiclePreview } from "@/lib/vehicle-preview";

/**
 * Esqueleto da ficha, com a forma da página: foto grande e, ao lado (no
 * computador) ou por baixo (no telemóvel), o nome, o preço e o "Interessado?".
 *
 * Vindo de um cartão, a foto desse cartão já aparece no lugar da galeria (e
 * "voa" do cartão para lá, com o mesmo nome de transição da galeria), por isso
 * a ficha parece abrir no instante do clique.
 */
export default function Loading() {
  const { slug } = useParams<{ slug: string }>();
  const photo = slug ? vehiclePreview(slug) : null;

  return (
    <div role="status" aria-label="A carregar a viatura" className="container-px pb-24 md:pt-8">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_25rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
        <ViewTransition name={slug ? `vehicle-${slug}` : undefined} share="vehicle-morph">
          <div className="relative -mx-6 aspect-[4/3] overflow-hidden bg-ink-muted md:mx-0 md:rounded-3xl xl:aspect-auto xl:min-h-[34rem]">
            {photo ? (
              <>
                {/* Como na galeria: a foto desfocada preenche as margens. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt="" className="absolute inset-0 h-full w-full object-contain" />
              </>
            ) : (
              <div className="absolute inset-0 bg-white/[0.06] motion-safe:animate-pulse" />
            )}
          </div>
        </ViewTransition>
        <div className="space-y-5">
          <div>
            <Skeleton className="h-8 w-3/4 rounded-xl" />
            <Skeleton className="mt-3 h-4 w-1/2 rounded-lg" />
          </div>
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-72 rounded-3xl" />
        </div>
      </div>
      <Skeleton className="mt-10 h-12 w-full max-w-xl rounded-2xl" />
      <Skeleton className="mt-4 h-48 rounded-3xl" />
    </div>
  );
}
