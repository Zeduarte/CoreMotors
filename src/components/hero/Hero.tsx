"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { HeroVideo } from "./HeroVideo";
import { AnimatedText } from "@/components/ui/AnimatedText";
import { asset } from "@/lib/asset";
import type { HeroMedia } from "@/lib/hero-media";
import { DEFAULT_HOME_CONTENT, type HeroContent } from "@/lib/home-content";

/**
 * Hero de topo.
 *
 * Arquitetura do pin: a secção exterior tem 224vh de altura, dando "pista" ao
 * scroll. Lá dentro, um wrapper `sticky top-0 h-screen` fica colado no ecrã —
 * usamos sticky CSS em vez de pin do GSAP porque coopera melhor com o smooth
 * scroll do Lenis e não reflowa a página. O `HeroVideo` lê o progresso do
 * scroll DESTA secção (via `triggerRef`) e transforma-o no `currentTime` do
 * vídeo (avança ao descer, recua ao subir).
 *
 * A camada de texto por cima é `pointer-events-none` (exceto os CTAs) para não
 * roubar o scroll ao vídeo.
 */
export function Hero({
  content = DEFAULT_HOME_CONTENT.hero,
  search,
  media = {
    type: "video",
    src: "/media/carros/topo.mp4",
    poster: "/media/carros/topo-poster.jpg",
  },
  raiseMediaOnMobile = false,
}: {
  content?: HeroContent;
  /** Cartão de pesquisa rápida, mostrado por baixo dos CTAs, sobre o vídeo. */
  search?: React.ReactNode;
  /** Vídeo (scroll) ou imagem fixa — detetado pelo ficheiro em public/media/carros|motas/. */
  media?: HeroMedia;
  /**
   * Telemóvel com pesquisa: sobe o fundo para o motivo (que na foto está no
   * terço de baixo) ficar no espaço livre entre o título e a pesquisa, em vez
   * de atrás da pesquisa. O fundo fica mais baixo do que o ecrã e desvanece
   * para o preto por baixo.
   */
  raiseMediaOnMobile?: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const isVideo = media.type === "video";
  // Cross-fade por scroll entre duas imagens (ex.: semáforo vermelho -> verde).
  const crossfade = media.type === "image" && Boolean(media.src2);

  // Progresso do scroll DESTA secção → opacidade da 2ª imagem (0 → 1).
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });
  const topOpacity = useTransform(scrollYProgress, [0.12, 0.62], [0, 1]);

  // O vídeo e o cross-fade precisam de "pista" de scroll + sticky; a imagem
  // fixa simples ocupa só o ecrã (melhor no telemóvel).
  const needsScroll = isVideo || crossfade;
  // Telemóvel com pesquisa: título no topo e pesquisa no fundo, para não
  // taparem o centro da imagem. A imagem ocupa o primeiro ecrã todo (menos o
  // header); a secção seguinte só aparece ao fazer scroll. A pesquisa fica
  // acima do botão do WhatsApp (fixo no canto de baixo).
  const split = Boolean(search);

  return (
    <section
      ref={sectionRef}
      // `-mt-16`: o topo sobe para trás da barra (que flutua num retângulo), e a
      // imagem chega ao cimo do ecrã à volta dela.
      className={`relative -mt-16 ${
        isVideo
          ? // No telemóvel menos "pista" de scroll no vídeo: a secção seguinte
            // aparece mais cedo.
            // Com a pesquisa, no telemóvel nem há pista: o hero tem só a
            // altura da imagem e o vídeo avança enquanto sai do ecrã.
            split
            ? "h-svh md:h-[140vh]"
            : "h-[120vh] md:h-[140vh]"
          : crossfade
            ? "h-[200vh]"
            : split
              ? "h-svh md:h-dvh"
              : "h-dvh"
      }`}
      aria-label="Viatura em destaque"
    >
      <div
        className={`flex w-full items-center justify-center ${
          needsScroll
            ? split
              ? "relative h-full overflow-hidden md:sticky md:top-0 md:h-dvh"
              : "sticky top-0 h-dvh overflow-hidden"
            : split
              ? "relative h-full md:min-h-dvh"
              : "relative min-h-dvh py-28 md:py-0"
        } ${split ? "max-md:items-stretch" : ""}`}
      >
        {/* Fundo: vídeo controlado pelo scroll OU imagem (fixa ou cross-fade) */}
        <div className="absolute inset-0 overflow-hidden bg-ink">
          <div
            className={`absolute inset-0 ${
              split && raiseMediaOnMobile
                ? // Altura pela largura (o motivo cabe de lado a lado) e topo
                  // a pôr o motivo a ~42% da altura abaixo da barra (os 4rem
                  // do topo ficam por trás dela; a foto entra a desvanecer, sem
                  // linha dura por baixo da barra).
                  "max-md:bottom-auto max-md:top-[calc(4rem+min(0px,calc(42%-1.68rem-76vw)))] max-md:h-[120vw] max-md:[mask-image:linear-gradient(to_bottom,transparent,#000_16%,#000_70%,transparent)]"
                : ""
            }`}
          >
            {isVideo ? (
              <HeroVideo
                triggerRef={sectionRef}
                sources={[{ src: asset(media.src), type: "video/mp4" }]}
                unpinnedOnMobile={split}
                poster={asset(media.poster)}
              />
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset(media.src)}
                  alt=""
                  className={`h-full w-full object-cover ${
                    crossfade ? "" : "hero-kenburns"
                  }`}
                />
                {crossfade && media.src2 && (
                  <motion.img
                    src={asset(media.src2)}
                    alt=""
                    style={{ opacity: topOpacity }}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Vinheta para garantir contraste AA do texto. Sobre imagem (que pode
            ser clara) escurece um pouco mais o centro. */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 bg-gradient-to-b ${
            isVideo
              ? "from-ink/70 via-transparent to-ink"
              : "from-ink/80 via-ink/30 to-ink"
          }`}
        />

        {/* Conteúdo */}
        <div
          className={`container-px pointer-events-none relative z-10 text-center ${
            split
              ? "max-md:flex max-md:flex-col max-md:pb-[5.75rem] max-md:pt-[5.5rem]"
              : ""
          }`}
        >
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="eyebrow hero-text-shadow mb-4 md:mb-6"
          >
            {content.eyebrow}
          </motion.p>

          <AnimatedText
            as="h1"
            splitBy="word"
            className={`hero-text-shadow mx-auto max-w-5xl text-display font-bold text-paper ${
              split ? "max-md:text-[2rem]" : ""
            }`}
          >
            {content.title}
          </AnimatedText>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
            className={`hero-text-shadow mx-auto mt-5 max-w-xl text-base font-light text-paper/80 md:mt-8 md:text-lg ${
              // No telemóvel, com a pesquisa, o topo fica só com o título e a
              // pesquisa — cabe no ecrã sem cortar a barra.
              search ? "hidden md:block" : ""
            }`}
          >
            {content.subtitle}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.6 }}
            // Com a pesquisa, os botões saem e a barra sobe para o lugar
            // deles; ficam só quando não há stock (sem barra).
            className={`pointer-events-auto mt-7 flex-col items-center justify-center gap-3 sm:flex-row md:mt-10 md:gap-4 ${
              search ? "hidden" : "flex"
            }`}
          >
            <Link
              href={content.primaryCta.href}
              className="rounded-full bg-accent px-8 py-3.5 text-sm font-semibold text-ink transition-transform duration-300 ease-premium hover:scale-[1.03]"
            >
              {content.primaryCta.label}
            </Link>
            <Link
              href={content.secondaryCta.href}
              className="rounded-full border border-paper/20 px-8 py-3.5 text-sm font-medium text-paper transition-colors duration-300 hover:border-paper/60"
            >
              {content.secondaryCta.label}
            </Link>
          </motion.div>

          {search && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9, duration: 0.6 }}
              className="pointer-events-auto mx-auto mt-7 w-full max-w-4xl text-left max-md:mt-auto md:mt-10"
            >
              {search}
            </motion.div>
          )}
        </div>

        {/* Indicador de scroll ("desça para ver mais"). Com a pesquisa não
            aparece: ficava por cima da barra. */}
        {!search && (
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.8 }}
            className="pointer-events-none absolute bottom-8 left-1/2 z-10 -translate-x-1/2"
          >
            <div className="flex h-10 w-6 items-start justify-center rounded-full border border-paper/30 p-1.5">
              <motion.span
                className="block h-2 w-1 rounded-full bg-paper/60"
                animate={{ y: [0, 8, 0] }}
                transition={{
                  duration: 1.6,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
