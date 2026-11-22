import { DM_Serif_Display } from "next/font/google";

/**
 * A letra serifada dos títulos e preços do Core2 (como nas maquetes), em
 * `--font-core2-serif` (ver `.core2-serif` em core2.css). Sem pré-carregar: o
 * ficheiro só se descarrega numa página que a use (o Core nunca usa).
 */
export const core2Serif = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-core2-serif",
});
