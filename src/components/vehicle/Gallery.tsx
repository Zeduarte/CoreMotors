"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { FadeImage } from "@/components/ui/FadeImage";
import { ViewTransition } from "@/components/ui/ViewTransition";
import type { VehicleImage, VehicleVideo } from "@/types/vehicle";

/** Distância mínima (px) para um arrasto contar como "passar à foto seguinte". */
const SWIPE = 40;

/**
 * Galeria da ficha de viatura, com lightbox (ecrã completo) e vídeo opcional.
 *
 * - Computador: miniaturas numa coluna à esquerda da foto grande, que ocupa a
 *   altura toda da linha (acompanha o preço e as características à direita).
 * - Telemóvel: foto de ponta a ponta e miniaturas numa fila por baixo.
 *
 * A foto ocupa sempre a moldura toda, de canto a canto (`object-cover`), sem
 * margens nem barras. Fotos quadradas ou ao alto são cortadas nos extremos; a
 * foto inteira vê-se no lightbox.
 *
 * A imagem principal partilha o nome de View Transition do `VehicleCard`
 * (`vehicle-<slug>`): a foto clicada cresce do cartão até aqui, e volta ao
 * cartão quando se regressa ao stock.
 *
 * O lightbox é desenhado no `<body>` (portal): dentro da página ficava sujeito
 * às camadas dela, e a área da foto tapava o botão de fechar.
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
  const [lightbox, setLightbox] = useState<"photo" | "video" | null>(null);
  const [mounted, setMounted] = useState(false);
  const thumbs = useRef<HTMLUListElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const current = images[active]!;
  const hasMultiple = images.length > 1;

  useEffect(() => setMounted(true), []);

  const step = useCallback(
    (dir: 1 | -1) => setActive((i) => (i + dir + images.length) % images.length),
    [images.length],
  );
  const close = useCallback(() => setLightbox(null), []);

  const swipe = useSwipe(step);
  const lightboxSwipe = useSwipe(step);

  // A miniatura ativa fica sempre à vista na tira (sem mexer no scroll da página).
  useEffect(() => {
    const list = thumbs.current;
    const el = list?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (!list || !el) return;
    const l = list.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const top = r.top < l.top ? r.top - l.top - 8 : r.bottom > l.bottom ? r.bottom - l.bottom + 8 : 0;
    const left = r.left < l.left ? r.left - l.left - 8 : r.right > l.right ? r.right - l.right + 8 : 0;
    if (top || left) list.scrollBy({ top, left, behavior: "smooth" });
  }, [active]);

  // Teclado, foco e bloqueio de scroll enquanto o lightbox está aberto.
  useEffect(() => {
    if (lightbox === null) return;
    const previous = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (lightbox === "photo") {
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, [lightbox, step]);

  return (
    <div className="flex flex-col gap-2 md:gap-3 xl:h-full xl:flex-row-reverse">
      <ViewTransition name={`vehicle-${slug}`} share="vehicle-morph">
        <div
          data-vt-gallery={slug}
          // Telemóvel: de ponta a ponta (anula a margem do `container-px`).
          className="group relative -mx-6 aspect-[4/3] cursor-zoom-in overflow-hidden bg-ink-muted md:mx-0 md:rounded-3xl xl:aspect-auto xl:min-h-0 xl:flex-1"
          onClick={() => {
            if (swipe.consume()) return;
            setLightbox("photo");
          }}
          {...swipe.handlers}
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
                sizes="(max-width: 1280px) 100vw, 60vw"
                className="object-cover"
              />
            </motion.div>
          </AnimatePresence>

          {video && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightbox("video");
              }}
              className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-black/75"
            >
              <PlayIcon /> Ver vídeo
            </button>
          )}

          {hasMultiple && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                aria-label="Foto anterior"
                className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/70"
              >
                <ChevronIcon dir="left" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                aria-label="Foto seguinte"
                className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/70"
              >
                <ChevronIcon dir="right" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox("photo");
            }}
            aria-label="Ver fotografias em ecrã completo"
            className="absolute bottom-3 left-3 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/70"
          >
            <ExpandIcon />
          </button>

          {hasMultiple && (
            <div className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
              <PhotosIcon />
              {active + 1} / {images.length}
            </div>
          )}
        </div>
      </ViewTransition>

      {hasMultiple && (
        // Telemóvel: fila com scroll horizontal próprio (nunca alarga a
        // página). Computador: coluna à esquerda; a lista é `absolute` para
        // não puxar pela altura da linha — tem a altura da foto e faz scroll.
        <div className="relative -mx-6 md:mx-0 xl:w-24 xl:shrink-0">
          <ul
            ref={thumbs}
            role="list"
            className="flex gap-2 overflow-x-auto overscroll-contain px-6 [scrollbar-width:none] md:px-0 xl:absolute xl:inset-0 xl:flex-col xl:gap-2.5 xl:overflow-y-auto xl:overflow-x-hidden [&::-webkit-scrollbar]:hidden"
          >
            {images.map((img, i) => (
              <li key={img.src} data-i={i} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-label={`Ver imagem ${i + 1}: ${img.alt}`}
                  aria-pressed={i === active}
                  className={`relative block aspect-[4/3] w-[5.5rem] overflow-hidden rounded-lg bg-ink-muted transition-opacity duration-300 md:w-28 xl:w-full ${
                    i === active ? "" : "opacity-55 hover:opacity-100"
                  }`}
                >
                  <Image src={img.src} alt="" fill sizes="112px" className="object-cover" />
                  {i === active && (
                    <span aria-hidden className="absolute inset-0 rounded-lg ring-2 ring-inset ring-accent" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mounted &&
        createPortal(
          <AnimatePresence>
            {lightbox !== null && (
              <motion.div
                key="lightbox"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-sm"
                onClick={close}
                role="dialog"
                aria-modal="true"
                aria-label="Galeria em ecrã completo"
              >
                {lightbox === "video" && video ? (
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <video
                      src={video.src}
                      controls
                      autoPlay
                      playsInline
                      className="max-h-[85vh] max-w-[92vw] rounded-xl"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                ) : (
                  // Clicar fora da foto fecha; na foto, não.
                  <div
                    className="absolute inset-0 flex items-center justify-center px-3 py-16 md:px-20"
                    {...lightboxSwipe.handlers}
                  >
                    <motion.div
                      key={current.src}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Image
                        src={current.src}
                        alt={current.alt}
                        width={current.width}
                        height={current.height}
                        sizes="100vw"
                        className="h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-[calc(100vw-1.5rem)] rounded-xl object-contain md:max-w-[calc(100vw-10rem)]"
                      />
                    </motion.div>
                  </div>
                )}

                <button
                  ref={closeBtn}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                  }}
                  aria-label="Fechar"
                  className="absolute right-3 top-3 z-10 grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 md:right-5 md:top-5"
                >
                  <CloseIcon />
                </button>

                {lightbox === "photo" && hasMultiple && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        step(-1);
                      }}
                      aria-label="Foto anterior"
                      className="absolute left-2 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 md:left-5"
                    >
                      <ChevronIcon dir="left" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        step(1);
                      }}
                      aria-label="Foto seguinte"
                      className="absolute right-2 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 md:right-5"
                    >
                      <ChevronIcon dir="right" />
                    </button>
                    <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-sm font-medium text-white">
                      {active + 1} / {images.length}
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}

/**
 * Deslizar o dedo para o lado muda de foto. `consume()` diz se o toque acabou
 * de ser um deslize (para esse toque não abrir também o ecrã completo).
 */
function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  return {
    consume() {
      const was = swiped.current;
      swiped.current = false;
      return was;
    },
    handlers: {
      onTouchStart(e: React.TouchEvent) {
        const t = e.touches[0]!;
        start.current = { x: t.clientX, y: t.clientY };
        swiped.current = false;
      },
      onTouchEnd(e: React.TouchEvent) {
        const s = start.current;
        start.current = null;
        if (!s) return;
        const t = e.changedTouches[0]!;
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) {
          swiped.current = true;
          onSwipe(dx < 0 ? 1 : -1);
        }
      },
    },
  };
}

const icon = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg {...icon} className="h-5 w-5" strokeWidth={2.2}>
      <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg {...icon} className="h-4 w-4" strokeWidth={2}>
      <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
    </svg>
  );
}

function PhotosIcon() {
  return (
    <svg {...icon} className="h-3.5 w-3.5" strokeWidth={2}>
      <rect x="7" y="7" width="13" height="13" rx="2" />
      <path d="M4 16V6a2 2 0 012-2h10" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...icon} className="h-5 w-5" strokeWidth={2.2}>
      <path d="M6 6l12 12M18 6L6 18" />
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
