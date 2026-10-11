"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { FadeImage } from "@/components/ui/FadeImage";
import { ViewTransition } from "@/components/ui/ViewTransition";
import type { VehicleImage, VehicleVideo } from "@/types/vehicle";

/**
 * Galeria da ficha de viatura, com lightbox (ecrã completo) e vídeo opcional.
 *
 * A imagem principal partilha o nome de View Transition do `VehicleCard`
 * (`vehicle-<slug>`): a foto clicada cresce do cartão até aqui, e volta ao
 * cartão quando se regressa ao stock. Clicar na
 * imagem abre o lightbox: navegação por setas/teclado, fecho por Esc ou clique
 * fora, e bloqueio do scroll do body enquanto está aberto.
 */
export function Gallery({
  slug,
  images,
  video,
}: {
  slug: string;
  images: VehicleImage[];
  video?: VehicleVideo | null;
}) {
  const [active, setActive] = useState(0);
  // lightbox: null = fechado; número = índice de imagem; "video" = vídeo.
  const [lightbox, setLightbox] = useState<number | "video" | null>(null);
  const current = images[active]!;
  const hasMultiple = images.length > 1;

  const step = useCallback(
    (dir: 1 | -1) => setActive((i) => (i + dir + images.length) % images.length),
    [images.length],
  );

  // Teclado + bloqueio de scroll enquanto o lightbox está aberto.
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (typeof lightbox === "number") {
        if (e.key === "ArrowRight") setActive((i) => (i + 1) % images.length);
        if (e.key === "ArrowLeft")
          setActive((i) => (i - 1 + images.length) % images.length);
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [lightbox, images.length]);

  return (
    <div>
      <ViewTransition name={`vehicle-${slug}`} share="vehicle-morph">
      <motion.div
        data-vt-gallery={slug}
        className="group relative aspect-[16/10] cursor-zoom-in overflow-hidden rounded-3xl bg-ink-muted"
        onClick={() => setLightbox(active)}
      >
        {/* Fade cruzado entre fotos (sem corte seco ao mudar). */}
        <AnimatePresence initial={false}>
          <motion.div
            key={current.src}
            className="absolute inset-0"
            exit={{ opacity: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }}
          >
            <FadeImage
              src={current.src}
              alt={current.alt}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 66vw"
              className="object-cover"
            />
          </motion.div>
        </AnimatePresence>

        {/* Ícone de ampliar (afeta descoberta do lightbox). */}
        <span className="pointer-events-none absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-ink/60 text-paper backdrop-blur transition-opacity md:can-hover:opacity-0 md:group-hover:opacity-100">
          <ZoomIcon />
        </span>

        {/* Botão de vídeo (se existir). */}
        {video && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox("video");
            }}
            className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full bg-ink/70 px-4 py-2 text-xs font-semibold text-paper backdrop-blur transition-colors hover:bg-ink/90"
          >
            <PlayIcon /> Ver vídeo
          </button>
        )}

        {/* Setas para percorrer as fotos. */}
        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              aria-label="Foto anterior"
              className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-ink/60 text-2xl text-paper backdrop-blur transition-colors hover:bg-ink/80 focus-visible:bg-ink/80 md:can-hover:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-visible:opacity-100"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              aria-label="Foto seguinte"
              className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-ink/60 text-2xl text-paper backdrop-blur transition-colors hover:bg-ink/80 focus-visible:bg-ink/80 md:can-hover:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-visible:opacity-100"
            >
              ›
            </button>
            <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-ink/70 px-2.5 py-1 text-xs font-medium text-paper backdrop-blur">
              {active + 1}/{images.length}
            </div>
          </>
        )}
      </motion.div>
      </ViewTransition>

      {images.length > 1 && (
        // Contentor com scroll horizontal PRÓPRIO: as miniaturas nunca
        // transbordam para a página (evita o scroll lateral em mobile).
        // `min-w-0`: a tira só pede a largura que a coluna lhe dá; sem isto
        // exigia a soma de todas as miniaturas e alargava a grelha.
        <div className="mt-4 -mx-1 min-w-0 overflow-x-auto overscroll-x-contain scroll-smooth px-1 pb-1 [scrollbar-width:thin]">
          <ul className="flex snap-x gap-3" role="list">
            {images.map((img, i) => (
              <li key={img.src} className="shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-label={`Ver imagem ${i + 1}: ${img.alt}`}
                  aria-pressed={i === active}
                  className={`relative aspect-[4/3] w-20 overflow-hidden rounded-xl transition-all duration-300 md:w-28 ${
                    i === active
                      ? "ring-2 ring-accent ring-offset-2 ring-offset-ink"
                      : "opacity-60 hover:opacity-100"
                  }`}
                >
                  <Image
                    src={img.src}
                    alt=""
                    fill
                    sizes="112px"
                    className="object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
            onClick={() => setLightbox(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Galeria em ecrã completo"
          >
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="Fechar"
              className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-2xl text-white transition-colors hover:bg-white/20"
            >
              ✕
            </button>

            {lightbox === "video" && video ? (
              <video
                src={video.src}
                controls
                autoPlay
                playsInline
                className="max-h-[85vh] max-w-[92vw] rounded-xl"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div
                className="relative flex h-full w-full items-center justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                <motion.div
                  key={images[active]!.src}
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="relative max-h-[85vh] w-full max-w-5xl"
                >
                  <Image
                    src={images[active]!.src}
                    alt={images[active]!.alt}
                    width={1600}
                    height={1000}
                    sizes="92vw"
                    className="mx-auto max-h-[85vh] w-auto rounded-xl object-contain"
                  />
                </motion.div>

                {hasMultiple && (
                  <>
                    <button
                      type="button"
                      onClick={() => step(-1)}
                      aria-label="Foto anterior"
                      className="absolute left-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-3xl text-white transition-colors hover:bg-white/20"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => step(1)}
                      aria-label="Foto seguinte"
                      className="absolute right-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-3xl text-white transition-colors hover:bg-white/20"
                    >
                      ›
                    </button>
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white">
                      {active + 1} / {images.length}
                    </div>
                  </>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ZoomIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="M21 21l-4.3-4.3M11 8v6M8 11h6" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
