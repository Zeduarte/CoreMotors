"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { ChatAction } from "@/lib/chat/actions";
import { historyPayload } from "@/lib/chat/conversation";

/**
 * Painel do assistente virtual.
 *
 * Só fala com `/api/chat` — não conhece a chave da API nem os dados do stand.
 * As respostas chegam em NDJSON e são escritas à medida que chegam.
 */

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: ChatAction[];
  /** Momento em que a mensagem entrou na conversa. */
  at: number;
  /** Assinatura do servidor (só respostas completas): volta no histórico. */
  sig?: string;
}

/** Teto por conversa: protege a fatura mesmo que alguém insista. */
const MAX_USER_MESSAGES = 20;

/** Perguntas sugeridas — o assistente só existe na ficha de viatura. */
export const STARTERS_VEHICLE = [
  "Esta viatura tem garantia?",
  "É nacional? Quantos donos teve?",
  "Posso marcar uma visita?",
];

const hora = new Intl.DateTimeFormat("pt-PT", {
  hour: "2-digit",
  minute: "2-digit",
});

export function ChatWidget({
  open,
  onClose,
  companyName,
  initialQuestion,
  onQuestionSent,
}: {
  open: boolean;
  onClose: () => void;
  companyName: string;
  /** Pergunta escrita fora do painel (barra fixa da ficha). */
  initialQuestion?: string | null;
  onQuestionSent?: () => void;
}) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hora da saudação. Só é definida no cliente — no servidor não há conversa,
  // por isso não há risco de a marcação divergir entre os dois.
  const [greetedAt, setGreetedAt] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Evita enviar duas vezes (o React em modo estrito corre o efeito a dobrar).
  const sentRef = useRef<string | null>(null);

  const userCount = messages.filter((m) => m.role === "user").length;
  const limitReached = userCount >= MAX_USER_MESSAGES;

  // Mantém a vista no fim à medida que a resposta é escrita.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    setGreetedAt((t) => t ?? Date.now());
  }, [open]);

  // Pergunta escrita na barra fixa: envia-a assim que o painel abre.
  useEffect(() => {
    if (!open || !initialQuestion || busy) return;
    if (sentRef.current === initialQuestion) return;
    sentRef.current = initialQuestion;
    onQuestionSent?.();
    void ask(initialQuestion);
    // `ask` é estável o suficiente para este disparo único por pergunta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuestion]);

  // Escape fecha o painel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function limpar() {
    setMessages([]);
    setError(null);
    sentRef.current = null;
    setGreetedAt(Date.now());
    inputRef.current?.focus();
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || limitReached) return;

    const now = Date.now();
    const history = [...messages, { role: "user" as const, content: text, at: now }];
    setMessages([...history, { role: "assistant", content: "", at: now }]);
    setInput("");
    setBusy(true);
    setError(null);

    // O assistente só precisa do texto (e da assinatura das respostas) — nunca
    // enviamos os botões nem as horas. Só as últimas trocas completas.
    const payload = historyPayload(messages, text);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload, pathname }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(
          data?.error ?? "Não foi possível falar com o assistente.",
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) applyEvent(line, setMessages, setError);
        }
      }
      if (buffer.trim()) applyEvent(buffer, setMessages, setError);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ocorreu um erro.");
      // Remove a bolha vazia — não deixa uma resposta em branco no ecrã.
      setMessages((prev) =>
        prev.filter((m, i) => !(i === prev.length - 1 && !m.content)),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          role="dialog"
          aria-label={`Assistente virtual do ${companyName}`}
          // Painel grande: em mobile ocupa o ecrã abaixo do header; em desktop
          // é uma coluna alta à direita, acima da barra da ficha.
          className="fixed inset-x-2 bottom-20 top-20 z-50 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-soft/95 shadow-2xl shadow-black/60 backdrop-blur-xl sm:inset-x-auto sm:right-5 sm:top-auto sm:h-[min(78vh,680px)] sm:w-[400px]"
        >
          <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-paper">
                  Assistente {companyName}
                </p>
                <p className="text-xs text-paper/50">
                  Responde sobre esta viatura
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={limpar}
                disabled={messages.length === 0}
                aria-label="Limpar conversa"
                title="Limpar conversa"
                className="grid h-8 w-8 place-items-center rounded-full text-paper/50 transition-colors hover:bg-white/10 hover:text-paper disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <EraserIcon />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Minimizar assistente"
                title="Minimizar"
                className="grid h-8 w-8 place-items-center rounded-full text-paper/50 transition-colors hover:bg-white/10 hover:text-paper"
              >
                <ChevronDownIcon />
              </button>
            </div>
          </header>

          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
          >
            {/* Saudação: não faz parte da conversa enviada ao modelo. */}
            <Bubble
              message={{
                role: "assistant",
                content: `Olá! Sou o assistente do ${companyName}. Em que posso ajudar?`,
                at: greetedAt ?? Date.now(),
              }}
              busy={false}
            />

            {messages.length === 0 && (
              <div className="space-y-2 pt-1">
                {STARTERS_VEHICLE.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="block rounded-2xl border border-white/10 px-3.5 py-2 text-left text-sm text-paper/80 transition-colors hover:border-accent hover:text-accent"
                  >
                    {s}
                  </button>
                ))}
                <p className="pt-2 text-xs leading-relaxed text-paper/40">
                  Não recolho dados pessoais — para isso uso os formulários do
                  site.
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <Bubble key={i} message={m} busy={busy && i === messages.length - 1} />
            ))}

            {error && (
              <p role="alert" className="text-sm text-red-300">
                {error}
              </p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2 border-t border-white/10 px-3 py-3"
          >
            <Avatar small />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={1000}
              disabled={busy || limitReached}
              placeholder={
                limitReached ? "Conversa terminada" : "Escreva a sua mensagem"
              }
              aria-label="Mensagem para o assistente"
              className="min-w-0 flex-1 bg-transparent px-1 text-sm text-paper placeholder:text-paper/40 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || limitReached || !input.trim()}
              aria-label="Enviar"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-ink transition-opacity disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </button>
          </form>

          {limitReached && (
            <p className="px-4 pb-3 text-xs text-paper/50">
              Para continuar, fale com a equipa através dos contactos do site.
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Bubble({ message, busy }: { message: Message; busy: boolean }) {
  const mine = message.role === "user";

  return (
    <div className={mine ? "flex flex-col items-end" : "flex flex-col items-start"}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          mine
            ? "rounded-br-md bg-accent text-ink"
            : "rounded-bl-md bg-white/8 text-paper/90"
        }`}
      >
        {message.content}
        {busy && !message.content && (
          <span className="inline-flex gap-1 align-middle" aria-label="A escrever">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-paper/40"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
        )}
      </div>

      <time className="mt-1 px-1 text-[11px] text-paper/35">
        {hora.format(message.at)}
      </time>

      {message.actions?.map((a) => <ActionButton key={a.label} action={a} />)}
    </div>
  );
}

function ActionButton({ action }: { action: ChatAction }) {
  const className =
    "mt-1 block rounded-full bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25";

  // Já estamos na página certa — rola até ao painel em vez de navegar.
  if (action.scrollTo) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => {
          const targets = document.querySelectorAll<HTMLElement>(
            `[data-chat-target="${action.scrollTo}"]`,
          );
          // A ficha rende o painel duas vezes (mobile e desktop); só um está visível.
          const visible = Array.from(targets).find((el) => el.offsetParent !== null);
          visible?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
      >
        {action.label}
      </button>
    );
  }

  if (action.href.startsWith("/")) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }

  return (
    <a
      href={action.href}
      target={action.href.startsWith("http") ? "_blank" : undefined}
      rel="noopener noreferrer"
      className={className}
    >
      {action.label}
    </a>
  );
}

function Avatar({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-accent text-ink ${
        small ? "h-8 w-8" : "h-9 w-9"
      }`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width={small ? 15 : 17} height={small ? 15 : 17} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
      </svg>
    </span>
  );
}

function EraserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 20H5l-2-2 9-9 6 6-5 5H8zM13 6l5 5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Aplica um evento NDJSON à última bolha do assistente. */
function applyEvent(
  line: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setError: (value: string | null) => void,
) {
  let event: { type?: string; value?: unknown };
  try {
    event = JSON.parse(line);
  } catch {
    return; // linha truncada — ignora-se em vez de partir a conversa
  }

  if (event.type === "text" && typeof event.value === "string") {
    const chunk = event.value;
    setMessages((prev) =>
      prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, content: m.content + chunk } : m,
      ),
    );
  } else if (event.type === "actions" && Array.isArray(event.value)) {
    const actions = event.value as ChatAction[];
    setMessages((prev) =>
      prev.map((m, i) => (i === prev.length - 1 ? { ...m, actions } : m)),
    );
  } else if (event.type === "sig" && typeof event.value === "string") {
    const sig = event.value;
    setMessages((prev) =>
      prev.map((m, i) => (i === prev.length - 1 ? { ...m, sig } : m)),
    );
  } else if (event.type === "error" && typeof event.value === "string") {
    setError(event.value);
  }
}
