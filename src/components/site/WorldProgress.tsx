import styles from "./WorldProgress.module.css";

/**
 * Anel com a percentagem de carregamento da troca carros ↔ motas.
 *
 * Sem estado do React: quem o mostra atualiza-o diretamente
 * (`setWorldProgress`), porque na página nova é um script que o faz andar
 * antes de o React arrancar. Daí também o `suppressHydrationWarning`.
 */
export function WorldProgress({ className = "" }: { className?: string }) {
  return (
    <span className={`${styles.ring} ${className}`} data-world-progress aria-hidden suppressHydrationWarning>
      <svg viewBox="0 0 48 48">
        <circle className={styles.track} cx="24" cy="24" r="21" />
        <circle className={styles.spin} cx="24" cy="24" r="21" pathLength={100} />
        <circle className={styles.bar} cx="24" cy="24" r="21" pathLength={100} data-bar suppressHydrationWarning />
      </svg>
      <span className={styles.pct} data-pct suppressHydrationWarning>
        0%
      </span>
    </span>
  );
}
