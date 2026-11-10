"use client";

import { createElement } from "react";
import { gsap } from "@/lib/gsap";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";

type SplitBy = "word" | "line" | "char";

interface AnimatedTextProps {
  children: string;
  /** Elemento HTML a renderizar (h1, h2, p…). */
  as?: keyof React.JSX.IntrinsicElements;
  /** Granularidade da animação de entrada. */
  splitBy?: SplitBy;
  className?: string;
  /** Atraso entre unidades (segundos). */
  stagger?: number;
  /** Atraso inicial global (segundos). */
  delay?: number;
  /** Palavras a realçar na cor de acento (ex.: ["premium", "costume"]). */
  highlight?: string[];
}

/**
 * "SplitText" manual — sem o plugin pago do GreenSock.
 *
 * Como funciona:
 *  - O texto é partido em unidades (palavras, linhas por parágrafo, ou letras)
 *    e cada unidade é embrulhada em dois spans: um exterior com
 *    `overflow: hidden` (a "máscara") e um interior que é animado. O efeito é
 *    o texto a "subir" de dentro da máscara, como nos sites de produto da Apple.
 *  - Acessibilidade: o texto original completo é mantido legível para leitores
 *    de ecrã via `aria-label`, e as unidades visuais ficam `aria-hidden`. Assim
 *    a experiência semântica é uma frase só, não uma sopa de spans.
 *  - Sem movimento (reduced-motion) o `useScrollAnimation` nunca corre o setup,
 *    logo os spans ficam no seu estado natural: visíveis.
 */
export function AnimatedText({
  children,
  as = "span",
  splitBy = "word",
  className,
  stagger = 0.08,
  delay = 0,
  highlight,
}: AnimatedTextProps) {
  const units = splitUnits(children, splitBy);
  const highlightSet = new Set((highlight ?? []).map((w) => w.toLowerCase()));
  const isHighlighted = (unit: string) =>
    highlightSet.has(unit.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));

  const ref = useScrollAnimation<HTMLElement>((root) => {
    const targets = root.querySelectorAll<HTMLElement>("[data-unit]");
    gsap.set(targets, { yPercent: 120 });
    const tween = { yPercent: 0, duration: 0.9, ease: "power3.out", stagger, delay };
    // Já à vista ao abrir a página (o título no topo): anima logo. À espera do
    // ScrollTrigger, o título do /quiz e de /contactos ficava escondido — o
    // conteúdo por baixo muda de altura depois de o gatilho ser medido, e ele
    // ficava à espera de um scroll que não acontecia.
    if (root.getBoundingClientRect().top < window.innerHeight * 0.85) {
      gsap.to(targets, tween);
      return;
    }
    gsap.to(targets, {
      ...tween,
      scrollTrigger: {
        trigger: root,
        start: "top 85%",
        once: true,
      },
    });
  });

  return createElement(
    as,
    {
      ref,
      className,
      "aria-label": children,
    },
    units.map((unit, i) => (
      <span
        key={i}
        aria-hidden="true"
        className="inline-block overflow-hidden align-bottom"
      >
        <span
          data-unit
          className={`inline-block will-change-transform ${isHighlighted(unit) ? "text-accent" : ""}`}
        >
          {unit}
          {splitBy !== "char" && i < units.length - 1 ? " " : ""}
        </span>
      </span>
    )),
  );
}

function splitUnits(text: string, by: SplitBy): string[] {
  if (by === "char") return Array.from(text);
  // "line" é aproximado sem medição de layout; partimos por frase/quebra para
  // um efeito linha-a-linha previsível. "word" é o mais robusto e usado por
  // defeito nos títulos.
  if (by === "line") return text.split(/(?<=\.)\s+|\n/).filter(Boolean);
  return text.split(/\s+/).filter(Boolean);
}
