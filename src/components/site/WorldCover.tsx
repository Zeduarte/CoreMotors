import type { CSSProperties } from "react";
import type { VehicleType } from "@/lib/vehicle-categories";
import { asset } from "@/lib/asset";
import { mediaFor } from "@/lib/media";
import { WorldProgress } from "./WorldProgress";
import styles from "./WorldCover.module.css";

/** Textos e cor de cada mundo — os mesmos do ecrã de entrada. */
const WORLD_COVER = {
  motorcycle: {
    title: "MOTAS",
    kicker: "INSTINTO SEM FILTROS",
    line: "Menos limites. Mais estrada.",
    accent: "#efbc79",
  },
  car: {
    title: "CARROS",
    kicker: "PAIXÃO EM CADA CURVA",
    line: "A tua próxima grande viagem.",
    accent: "#a9cde7",
  },
} as const;

/**
 * Ecrã cheio de um mundo (foto da entrada + título), usado na troca entre
 * carros e motas: na página antiga entra por cima (`styles.depart`) e na nova
 * sai para o lado (`styles.arrival`). Sem hooks: serve ao servidor e ao cliente.
 */
export function WorldCoverArt({ type, lazy = false }: { type: VehicleType; lazy?: boolean }) {
  const w = WORLD_COVER[type];
  return (
    <div className={styles.art} style={{ "--world-accent": w.accent } as CSSProperties}>
      {/* `lazy` na chegada: escondida, a foto não é descarregada em cada página.
          Quando a capa aparece, o script do `WorldArrival` passa-a a "eager"
          antes de o React arrancar — daí o suppressHydrationWarning. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset(mediaFor(type).entrada)}
        alt=""
        loading={lazy ? "lazy" : "eager"}
        suppressHydrationWarning={lazy}
        className={styles.photo}
      />
      <span className={styles.shade} />
      <span className={styles.speedLines} aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className={styles.copy}>
        <span className={styles.kicker}>{w.kicker}</span>
        <span className={styles.title}>
          {[...w.title].map((letter, i) => (
            <span key={i} style={{ "--letter": i } as CSSProperties}>
              {letter}
            </span>
          ))}
          <span className={styles.dot}>.</span>
        </span>
        <span className={styles.line}>{w.line}</span>
      </span>
      {/* Quanto falta para a página nova (ver `world-arrival.ts`). */}
      <WorldProgress className={styles.progress} />
    </div>
  );
}

export { styles as worldCoverStyles };
