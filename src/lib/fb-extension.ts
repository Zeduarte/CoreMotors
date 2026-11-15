/**
 * Conversa com a extensão «CoreMotors Partilhas» (pasta /extension), no
 * browser. A extensão injeta uma ponte nas páginas /admin… e responde por
 * `window.postMessage`; os cliques no Facebook são feitos por ela, numa
 * janela própria do Chrome de quem está a usar o backoffice.
 *
 * Por segurança a extensão só obedece a sites que o utilizador autorizou no
 * ícone dela («Autorizar este site»): até lá, `hello` responde `paired: false`.
 */
import type { ScannedGroup, ShareResultStatus } from "@/lib/fb-shares";

const PAGE = "coremotors-partilhas-page";
const EXT = "coremotors-partilhas-ext";

export interface ExtensionHello {
  version: string;
  paired: boolean;
  /** A conta do Facebook aberta no Chrome (null = sem sessão, ou site não autorizado). */
  fbUserId: string | null;
}

export interface ReadGroupsResult {
  fbUserId: string;
  groups: ScannedGroup[];
}

export interface ShareOneResult {
  status: ShareResultStatus;
  reason: string;
  /** Parar a fila depois deste grupo (limite, verificação, erro inesperado). */
  stop: boolean;
}

type Command =
  | { type: "hello" }
  | { type: "readGroups" }
  | { type: "share"; payload: { adUrl: string; groupName: string; groupUrl: string | null } };

export class ExtensionError extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "not_paired" | "failed" = "failed",
  ) {
    super(message);
  }
}

let seq = 0;

function send<T>(command: Command, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${++seq}`;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(
        command.type === "hello"
          ? new ExtensionError("A extensão não respondeu.", "missing")
          : new ExtensionError("A extensão deixou de responder. Veja a janela do Facebook e tente de novo."),
      );
    }, timeoutMs);
    function onMessage(e: MessageEvent) {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const data = e.data as { source?: string; id?: string; ok?: boolean; result?: T; error?: string; code?: string };
      if (!data || data.source !== EXT || data.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (data.ok) resolve(data.result as T);
      else reject(new ExtensionError(data.error || "A extensão devolveu um erro.", data.code === "not_paired" ? "not_paired" : "failed"));
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: PAGE, id, ...command }, window.location.origin);
  });
}

/** A extensão está instalada? Que versão, se este site está autorizado e que Facebook está aberto. */
export function extensionHello(): Promise<ExtensionHello> {
  return send<ExtensionHello>({ type: "hello" }, 1500);
}

/** Abre a lista de grupos do Facebook e lê-a (pode demorar mais de um minuto). */
export function extensionReadGroups(): Promise<ReadGroupsResult> {
  return send<ReadGroupsResult>({ type: "readGroups" }, 4 * 60_000);
}

/** Partilha o anúncio num grupo: abre o anúncio, «Partilhar» → «Grupo», escolhe e publica. */
export function extensionShare(adUrl: string, groupName: string, groupUrl: string | null): Promise<ShareOneResult> {
  return send<ShareOneResult>({ type: "share", payload: { adUrl, groupName, groupUrl } }, 4 * 60_000);
}
