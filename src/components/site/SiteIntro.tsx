import type { CSSProperties } from "react";
import { getImageProps } from "next/image";
import { INTRO_IMAGE, introScript, srcAtWidth } from "@/lib/site-intro";
import styles from "./SiteIntro.module.css";

/**
 * Entrada do site público na 1.ª visita (ver `src/lib/site-intro.ts`): a
 * fotografia das motas por cima do site enquanto ele carrega.
 *
 * Vem no HTML escondida (`display: none`); o script inline, que corre antes de
 * a entrada ser desenhada, põe `data-intro="show"` no `<html>` só na 1.ª
 * visita. A foto é um fundo CSS, e não um `<img>`: escondida, o browser nem a
 * descarrega — quem já cá esteve não paga a imagem.
 *
 * Decorativa (`aria-hidden`): o conteúdo da página está todo por baixo, no
 * HTML. O backoffice tem outra layout, por isso nunca a mostra.
 */
export function SiteIntro({ name, label }: { name: string; label: string }) {
  // Imagem otimizada pelo Next (AVIF/WebP). 1200 px chegam para um telemóvel
  // de alta densidade e para a coluna da foto num computador.
  const { srcSet, src } = getImageProps({ src: INTRO_IMAGE, alt: "", fill: true, sizes: "100vw" }).props;
  const url = srcAtWidth(srcSet, 1200) ?? src;
  const style = { "--intro-photo": `url("${url}")` } as CSSProperties;

  return (
    <>
      {/* Antes da entrada: decide se ela aparece antes de ser desenhada. */}
      <script dangerouslySetInnerHTML={{ __html: introScript() }} />
      <div className={styles.intro} style={style} aria-hidden="true" data-lenis-prevent>
        <span className={styles.backdrop} />
        <span className={styles.photo} />
        <span className={styles.shade} />
        <div className={styles.copy}>
          <span className={styles.kicker}>Bem-vindo</span>
          <span className={styles.brand}>
            {name}
            <span className={styles.dot}>.</span>
          </span>
          <span className={styles.label}>{label}</span>
          <span className={styles.progress}>
            <span />
          </span>
        </div>
      </div>
    </>
  );
}
