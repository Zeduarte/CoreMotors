/**
 * Domínios para onde o webhook dos contactos pode enviar. A lista vem do
 * servidor (`NOTIFICATION_WEBHOOK_HOSTS`, separada por vírgulas); sem ela, a
 * predefinida. É a mesma ao gravar nas Integrações e ao enviar.
 */
export const DEFAULT_WEBHOOK_HOSTS =
  "hooks.slack.com,discord.com,discordapp.com,hook.eu1.make.com,hook.us1.make.com,hooks.zapier.com";

export function webhookHosts(env: string | undefined = process.env.NOTIFICATION_WEBHOOK_HOSTS): string[] {
  return (env ?? DEFAULT_WEBHOOK_HOSTS)
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * O que impede este URL de servir de webhook, ou `null` se serve. Só HTTPS,
 * sem credenciais no URL e num dos domínios autorizados.
 */
export function webhookUrlProblem(value: string, hosts: string[] = webhookHosts()): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "URL do webhook inválido.";
  }
  if (url.protocol !== "https:") return "O webhook tem de usar HTTPS.";
  if (url.username || url.password) return "O URL do webhook não pode levar credenciais.";
  if (!hosts.includes(url.hostname.toLowerCase()))
    return `Domínio do webhook não autorizado (${url.hostname}). Autorizados: ${hosts.join(", ")}.`;
  return null;
}
