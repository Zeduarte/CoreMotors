/* CoreMotors — Service Worker DESATIVADO (kill switch).
 *
 * O SW anterior fazia cache dos chunks (_next/static) e servia versões antigas,
 * que apontavam para IDs de Server Actions já inexistentes ("Server Action not
 * found"). Foi removido.
 *
 * Esta versão não faz cache de nada: desregista-se a si própria e apaga todas
 * as caches. Assim, qualquer browser que ainda tenha o SW antigo fica limpo
 * automaticamente na próxima visita.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* ignore */
      }
      try {
        await self.registration.unregister();
      } catch {
        /* ignore */
      }
      // Recarrega as páginas abertas para deixarem de ser controladas pelo SW.
      try {
        const clients = await self.clients.matchAll({ type: "window" });
        clients.forEach((c) => c.navigate(c.url));
      } catch {
        /* ignore */
      }
    })(),
  );
});

// Sem handler de "fetch": nada é servido da cache — tudo vai à rede.
