"use client";

import { useRef } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";
import { prefersReducedMotionNow, usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { asset } from "@/lib/asset";

interface VideoSource {
  src: string;
  type: string;
}

interface HeroVideoProps {
  /** Elemento que define a área de scroll (o wrapper alto do hero). */
  triggerRef: React.RefObject<HTMLElement | null>;
  /**
   * Fontes do vídeo por ordem de preferência. O browser escolhe a primeira que
   * suporta: webm/VP9 (mais leve, Chrome/Firefox) com fallback mp4/H.264
   * (Safari e todos os outros).
   */
  sources?: VideoSource[];
  /** Imagem de cartaz mostrada antes do vídeo carregar (opcional). */
  poster?: string;
  /**
   * No telemóvel o hero não fica preso (não há "pista" de scroll): o vídeo
   * avança enquanto o hero sai do ecrã, em vez de até ao fim da pista.
   */
  unpinnedOnMobile?: boolean;
}

// Um único ficheiro (mp4, o formato universal) para simplificar a troca do
// vídeo: basta substituir public/media/carros/topo.mp4. Evita a confusão de o browser
// preferir um .webm antigo quando só o .mp4 é atualizado.
const DEFAULT_SOURCES: VideoSource[] = [
  { src: asset("/media/carros/topo.mp4"), type: "video/mp4" },
];

/**
 * Vídeo do hero "scrubbed" pelo scroll: em vez de reproduzir sozinho, o
 * `currentTime` do vídeo é conduzido pela posição do scroll — descer avança o
 * vídeo, subir recua-o.
 *
 * Decisões:
 *  - `muted` + `playsInline` + `preload="auto"`: requisitos para conseguir
 *    controlar o vídeo por JS (e para o iOS não abrir em ecrã inteiro). Nunca
 *    chamamos `play()`; movemos só o `currentTime`.
 *  - Esperamos por `loadedmetadata` para conhecer a `duration` antes de criar
 *    o ScrollTrigger — sem isso o mapeamento scroll→tempo seria inválido.
 *  - GSAP faz o tween da propriedade `currentTime` com `scrub`, o que suaviza o
 *    seeking (evita saltos bruscos entre frames).
 *  - `prefers-reduced-motion`: não criamos ScrollTrigger nenhum; o vídeo fica
 *    parado num frame inicial (estado final legível).
 *
 * Nota de performance: o scrubbing de vídeo só é fluido se o ficheiro tiver
 * keyframes frequentes. Ver instruções de re-encode no fim (ffmpeg).
 */
export function HeroVideo({
  triggerRef,
  sources = DEFAULT_SOURCES,
  poster,
  unpinnedOnMobile = false,
}: HeroVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const prefersReduced = usePrefersReducedMotion();

  useIsomorphicLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let st: ScrollTrigger | undefined;
    let tween: gsap.core.Tween | undefined;

    const setup = () => {
      const duration = video.duration;
      // Lemos o trigger aqui (não no topo do efeito): o `loadedmetadata` pode
      // disparar noutro tick, e queremos a ref já garantidamente montada.
      // O trigger é a secção alta do hero. Preferimos a ref explícita, mas
      // recorremos ao ancestral <section> mais próximo — robusto a qualquer
      // ordem de attach da ref.
      const trigger = triggerRef.current ?? video.closest("section");
      if (!duration || Number.isNaN(duration)) return;

      // Sem movimento: mostra um frame estático e não liga o scroll.
      if (prefersReduced || prefersReducedMotionNow() || !trigger) {
        video.currentTime = Math.min(0.1, duration);
        return;
      }

      // Alguns browsers só permitem seeking depois de um play()/pause().
      video.pause();

      tween = gsap.to(video, {
        currentTime: duration,
        ease: "none",
        scrollTrigger: {
          trigger,
          start: "top top",
          end:
            unpinnedOnMobile && window.matchMedia("(max-width: 767px)").matches
              ? "bottom top"
              : "bottom bottom",
          scrub: 0.5,
        },
      });
      st = tween.scrollTrigger;
    };

    // `duration` pode já estar disponível (cache) ou chegar por evento.
    if (video.readyState >= 1) {
      setup();
    } else {
      video.addEventListener("loadedmetadata", setup, { once: true });
    }

    return () => {
      video.removeEventListener("loadedmetadata", setup);
      st?.kill();
      tween?.kill();
    };
  }, [prefersReduced, unpinnedOnMobile]);

  return (
    <video
      ref={videoRef}
      className="h-full w-full object-cover"
      poster={poster}
      muted
      playsInline
      preload="auto"
      // O vídeo é decorativo; o significado está no texto do hero.
      aria-hidden="true"
    >
      {sources.map((s) => (
        <source key={s.src} src={s.src} type={s.type} />
      ))}
    </video>
  );
}
