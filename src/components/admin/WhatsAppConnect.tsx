"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { connectWhatsApp, disconnectWhatsApp } from "@/lib/actions/whatsapp";
import type { ConnectResult, EmbeddedSignup } from "@/lib/whatsapp/account";

/**
 * «Ligar número do WhatsApp»: abre o Embedded Signup da Meta, onde o
 * administrador entra com a conta do Facebook da empresa e escolhe (ou cria) a
 * conta do WhatsApp Business e o número.
 *
 * A Meta devolve duas coisas por caminhos diferentes, e é preciso juntá-las:
 *  - o `code` de uso único, na resposta do `FB.login`;
 *  - a conta e o número escolhidos, numa mensagem `postMessage` da janela.
 * O servidor confirma que os três batem certo antes de gravar seja o que for.
 */

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
}

declare global {
  interface Window {
    FB?: {
      init(options: Record<string, unknown>): void;
      login(callback: (response: FbLoginResponse) => void, options: Record<string, unknown>): void;
    };
    fbAsyncInit?: () => void;
  }
}

/** Só mensagens da própria Meta. `endsWith("facebook.com")` deixava passar «evilfacebook.com». */
const META_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*facebook\.com$/;

let sdk: Promise<void> | null = null;

function loadSdk(signup: EmbeddedSignup): Promise<void> {
  if (sdk) return sdk;
  sdk = new Promise<void>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({
        appId: signup.appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: signup.graphVersion,
      });
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/pt_PT/sdk.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdk = null;
      reject(new Error("sdk"));
    };
    document.body.appendChild(script);
  });
  return sdk;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function WhatsAppConnect({
  signup,
  connected,
}: {
  signup: EmbeddedSignup | null;
  connected: boolean;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectResult | null>(null);
  const chosen = useRef<{ wabaId: string; phoneNumberId: string } | null>(null);
  const failure = useRef<string | null>(null);

  const appId = signup?.appId;
  const configId = signup?.configId;
  const version = signup?.graphVersion;

  useEffect(() => {
    if (!appId || !configId || !version) return;
    let alive = true;
    loadSdk({ appId, configId, graphVersion: version })
      .then(() => alive && setReady(true))
      .catch(
        () =>
          alive &&
          toast.error(
            "Não foi possível carregar a janela da Meta. Um bloqueador de anúncios pode estar a impedi-la.",
          ),
      );

    const onMessage = (event: MessageEvent) => {
      if (!META_ORIGIN.test(event.origin) || typeof event.data !== "string") return;
      let message: { type?: string; event?: string; data?: Record<string, unknown> };
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message?.type !== "WA_EMBEDDED_SIGNUP") return;
      const data = message.data ?? {};
      if (message.event === "FINISH" && data.phone_number_id && data.waba_id) {
        chosen.current = {
          wabaId: String(data.waba_id),
          phoneNumberId: String(data.phone_number_id),
        };
      } else if (message.event === "FINISH_ONLY_WABA") {
        failure.current =
          "A conta do WhatsApp Business ficou criada, mas sem número. Volte a ligar e escolha ou adicione um número.";
      } else if (message.event === "CANCEL") {
        failure.current = data.error_message
          ? `A Meta interrompeu a ligação: ${String(data.error_message)}`
          : "A ligação foi cancelada na janela da Meta.";
      } else if (message.event === "ERROR") {
        failure.current = `A Meta devolveu um erro: ${String(data.error_message ?? "sem detalhe")}`;
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      alive = false;
      window.removeEventListener("message", onMessage);
    };
  }, [appId, configId, version]);

  async function finish(code: string) {
    // A mensagem com o número costuma chegar antes do `code`, mas não é
    // garantido: espera-se por ela até 5 segundos.
    for (let i = 0; i < 20 && !chosen.current && !failure.current; i++) await wait(250);
    const ids = chosen.current;
    if (!ids) {
      setBusy(false);
      toast.error(failure.current ?? "A Meta não indicou o número escolhido. Tente outra vez.");
      return;
    }
    try {
      const r = await connectWhatsApp({ code, ...ids });
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível ligar o número.");
        return;
      }
      setResult(r);
      toast.success(`WhatsApp ligado${r.number ? `: ${r.number}` : ""}.`);
      router.refresh();
    } catch {
      toast.error("Não foi possível ligar o número. Tente outra vez.");
    } finally {
      setBusy(false);
    }
  }

  function connect() {
    if (!window.FB || !configId) return;
    chosen.current = null;
    failure.current = null;
    setResult(null);
    setBusy(true);
    // O callback do FB.login não pode ser `async` (o SDK recusa-o).
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setBusy(false);
          toast.error(failure.current ?? "A ligação foi cancelada.");
          return;
        }
        void finish(code);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  }

  async function disconnect() {
    if (
      !confirm(
        "Desligar o número do WhatsApp? As ordens por WhatsApp deixam de ser respondidas (a não ser que o número esteja também nas variáveis do Netlify).",
      )
    )
      return;
    setBusy(true);
    try {
      const r = await disconnectWhatsApp();
      if (r.ok) toast.success("Número do WhatsApp desligado.");
      else toast.error(r.error ?? "Não foi possível desligar.");
      setResult(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {result?.ok && (
        <div role="status" className="rounded-xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-200">
          <p>
            Ligado ao número <strong>{result.number ?? "escolhido"}</strong>
            {result.name ? ` (${result.name})` : ""}.
          </p>
          {result.pin && (
            <p className="mt-1">
              PIN da verificação em dois passos:{" "}
              <strong className="font-mono tracking-widest">{result.pin}</strong>. Anote-o: a Meta
              pede-o se algum dia passar este número para outra aplicação. Esta mensagem não volta a
              aparecer.
            </p>
          )}
          {result.expiresAt && (
            <p className="mt-1">
              O acesso dado pela Meta vale até{" "}
              {new Date(result.expiresAt).toLocaleDateString("pt-PT")}. O painel avisa quando for
              altura de voltar a ligar.
            </p>
          )}
          {result.warning && <p className="mt-1 text-amber-200">{result.warning}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {signup && (
          <button
            type="button"
            className="btn-primary"
            disabled={!ready || busy}
            onClick={connect}
          >
            {busy ? "A ligar…" : connected ? "Trocar de número" : "Ligar número do WhatsApp"}
          </button>
        )}
        {connected && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={disconnect}>
            Desligar
          </button>
        )}
      </div>
    </div>
  );
}
