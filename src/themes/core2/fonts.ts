import localFont from "next/font/local";

/**
 * A letra serifada dos títulos e preços do Core2 (como nas maquetes), em
 * `--font-core2-serif` (ver `.core2-serif` em core2.css). Sem pré-carregar: o
 * ficheiro só se descarrega numa página que a use (o Core nunca usa). Vem do
 * próprio projeto (src/fonts), para o build não depender do Google Fonts.
 */
export const core2Serif = localFont({
  src: "../../fonts/dm-serif-display-latin-400-normal.woff2",
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-core2-serif",
});
