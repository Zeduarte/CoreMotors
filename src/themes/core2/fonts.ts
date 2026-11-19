import { DM_Serif_Display } from "next/font/google";

/** A letra serifada dos títulos e preços do Core2 (como nas maquetes). */
export const core2Serif = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-core2-serif",
});
