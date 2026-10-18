/**
 * Serializa JSON-LD para dentro de um <script type="application/ld+json">
 * sem permitir que o conteúdo feche a tag (`</script>`) ou abra comentários
 * HTML (`<!--`). Escapa `<`, `>`, `&` e os separadores U+2028/U+2029; o JSON
 * resultante continua a ser válido e equivalente.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
