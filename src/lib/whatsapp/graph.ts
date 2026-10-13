import "server-only";

/**
 * Pedidos ao Graph API da Meta, partilhados pelo envio de respostas e pela
 * ligação do número no backoffice.
 *
 * A versão vem de `WHATSAPP_GRAPH_VERSION` porque a Meta a descontinua
 * periodicamente. O valor por defeito é o que o painel da app mostrava em
 * setembro de 2026 (no exemplo de envio do "Step 1. Try it out"); quando a Meta
 * o descontinuar, basta mudar a variável no Netlify.
 */

const DEFAULT_GRAPH_VERSION = "v25.0";

export function graphVersion(): string {
  return process.env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
}

/**
 * Destino configurável como o ANTHROPIC_BASE_URL, para os testes poderem
 * apontar a um servidor local. Vazio = a Meta.
 */
export function graphBase(): string {
  return (process.env.WHATSAPP_GRAPH_BASE_URL || "https://graph.facebook.com").replace(/\/$/, "");
}

export type GraphResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Um pedido ao Graph API. Nunca lança: devolve o erro da Meta em texto, para
 * quem chama decidir o que dizer ao administrador.
 */
export async function graphRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    token?: string;
    query?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<GraphResult<T>> {
  const url = new URL(`${graphBase()}/${graphVersion()}/${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      // Tempo limite curto e sem seguir redireccionamentos, que num pedido com
      // o token seriam uma fuga (como em src/lib/notifications.ts).
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    const data = (await response.json().catch(() => null)) as
      | (T & { error?: { message?: string } })
      | null;
    if (!response.ok) {
      const message = data?.error?.message;
      return { ok: false, error: message ? message.slice(0, 200) : `HTTP ${response.status}` };
    }
    return { ok: true, data: (data ?? {}) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Falha no pedido à Meta" };
  }
}
