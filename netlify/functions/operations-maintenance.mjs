/** Netlify runs this only on the published deployment, never on branch previews. */
export default async () => {
  const origin = process.env.URL || process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.MAINTENANCE_SECRET;
  if (!origin || !secret) throw new Error("Configure MAINTENANCE_SECRET e o URL do site.");
  // Sempre por HTTPS: se o domínio ainda não tinha certificado no momento do
  // deploy, o Netlify dá-o como http:// — e o redireccionamento para https
  // fazia falhar a chamada (o pedido nunca chegava à manutenção).
  const url = new URL("/api/maintenance", origin);
  url.protocol = "https:";
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(25000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Manutenção falhou: HTTP ${response.status}`);
};
// De 15 em 15 minutos: chega para expirar reservas, avisar de contactos novos
// e sincronizar o OLX. De minuto a minuto gastava os créditos do Netlify.
// Os avisos por WhatsApp à equipa normalmente saem logo a seguir à ação que os
// cria; aqui saem os que falharam e os das viaturas criadas pelo assistente do
// WhatsApp.
export const config = { schedule: "*/15 * * * *" };
