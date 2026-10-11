import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  // `hover:` só em dispositivos com rato. Nos ecrãs tácteis o browser usa o
  // 1.º toque para "passar o rato" quando isso mostra alguma coisa, e o
  // visitante tinha de tocar duas vezes num cartão para o abrir.
  future: { hoverOnlyWhenSupported: true },
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    // Container central com respiração generosa (design premium = espaço negativo).
    extend: {
      colors: {
        // Paleta escura com um único acento. Definida via CSS vars para ser
        // trivialmente re-tematizável (ver globals.css).
        ink: {
          DEFAULT: "#0A0A0A",
          soft: "#111112",
          muted: "#18181B",
        },
        paper: "#F5F5F4",
        accent: {
          DEFAULT: "var(--accent)",
          soft: "var(--accent-soft)",
        },
      },
      fontFamily: {
        // Inter carregado via next/font (ver layout.tsx) e exposto como var.
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Escala tipográfica confiante — títulos grandes.
        "display": ["clamp(2.35rem, 9vw, 9rem)", { lineHeight: "0.98", letterSpacing: "-0.03em" }],
        "headline": ["clamp(1.75rem, 5vw, 4rem)", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
      maxWidth: {
        // Largura máxima do conteúdo: quase o ecrã todo, como os grandes
        // portais — sem as faixas vazias dos lados em ecrãs largos.
        content: "105rem",
      },
      transitionTimingFunction: {
        // Curva "Apple-like": arranque rápido, aterragem suave.
        premium: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Faixa de marcas: a lista vai duplicada, por isso −50% fecha o ciclo.
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        marquee: "marquee 28s linear infinite",
      },
    },
  },
  plugins: [
    // `can-hover:` — o mesmo critério para esconder controlos que só aparecem
    // ao passar o rato (num ecrã táctil ficam visíveis ou não existem).
    plugin(({ addVariant }) => {
      addVariant("can-hover", "@media (hover: hover) and (pointer: fine)");
    }),
  ],
};

export default config;
