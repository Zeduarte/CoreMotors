/**
 * Devolve o caminho de um asset estático de `/public`.
 *
 * O site é servido na raiz do domínio (Netlify), por isso o caminho não leva
 * prefixo. Mantém-se como ponto único para `src` de `<video>`, `<source>` e
 * `poster`, que o Next não reescreve.
 */
export function asset(path: string): string {
  return path;
}
