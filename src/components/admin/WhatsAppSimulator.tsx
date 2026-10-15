"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { simulateInbound } from "@/lib/actions/whatsapp";

/**
 * Caixa de simulação: escreve-se a ordem como se fosse pelo WhatsApp e vê-se a
 * resposta. Grava a sério — é para isso que serve.
 *
 * A conversa é tratada como sendo do utilizador com sessão, com as permissões
 * dele: se ele não pode lançar custos, aqui também não.
 */
const EXEMPLOS = [
  "registaa um novo audi a1 com a matricula 00-TE-00",
  "coloca uma despesa de 450 de troca de embraiagem e revisao geral ao bmw 320 preto",
  "das 9h às 17h30 no bmw 320, mudança de travões",
  "baixa o preço do bmw 320 para 23 500",
  "o contacto do joão silva perdeu-se, comprou noutro stand",
  "quanto já gastei no bmw 320?",
];

interface Linha {
  de: "eu" | "assistente";
  texto: string;
  gravou?: boolean;
  /** A proposta como imagem — a mesma que segue pelo WhatsApp. */
  imagem?: string;
}

export function WhatsAppSimulator() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [texto, setTexto] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [erro, setErro] = useState("");

  function enviar(valor: string) {
    const mensagem = valor.trim();
    if (!mensagem) return;
    setErro("");
    setTexto("");
    setLinhas((l) => [...l, { de: "eu", texto: mensagem }]);
    start(async () => {
      const data = new FormData();
      data.set("text", mensagem);
      const res = await simulateInbound(data);
      if (!res.ok) {
        setErro(res.error ?? "Não foi possível simular.");
        return;
      }
      setLinhas((l) => [
        ...l,
        {
          de: "assistente",
          texto: res.reply || "(sem resposta)",
          gravou: res.wrote,
          imagem: res.image,
        },
      ]);
      // Uma escrita muda os custos e a oficina: recarrega para se ver logo.
      if (res.wrote) router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-paper/50">
        Experimentar
      </h3>
      <p className="mt-1 text-xs text-paper/50">
        Escreva como escreveria no WhatsApp. Corre o mesmo código do canal real e
        grava de verdade, como se fosse você a dar a ordem.
      </p>

      {linhas.length > 0 && (
        <ul className="mt-4 space-y-2">
          {linhas.map((l, i) => (
            <li
              key={i}
              className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
                // `bg-accent/15` não funciona neste projecto: o acento é uma
                // variável CSS e o modificador de opacidade do Tailwind fica
                // transparente. O color-mix aplica a opacidade à variável.
                l.de === "eu"
                  ? "ml-auto bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-paper"
                  : "bg-white/[0.06] text-paper/90"
              }`}
            >
              {l.imagem && (
                // Uma imagem gerada no servidor, já no tamanho final e com
                // link que expira: o next/image não traz nada aqui e o
                // otimizador ia guardá-la em cache para além do prazo.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={l.imagem}
                  alt="A proposta, como o formulário preenchido"
                  className="mb-2 block w-full max-w-sm rounded-lg border border-white/10"
                />
              )}
              <span className="whitespace-pre-line">{l.texto}</span>
              {l.gravou && (
                <span className="mt-1 block text-xs font-medium text-emerald-300">
                  gravado no backoffice
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {erro && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {erro}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {EXEMPLOS.map((e) => (
          <button
            key={e}
            type="button"
            disabled={pending}
            onClick={() => enviar(e)}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-paper/70 transition-colors hover:border-accent hover:text-paper disabled:opacity-50"
          >
            {e.length > 46 ? `${e.slice(0, 46)}…` : e}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(texto);
        }}
      >
        <input
          className="field flex-1"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escreva a ordem…"
          maxLength={1000}
          aria-label="Mensagem a simular"
        />
        <button className="btn-primary shrink-0" disabled={pending || !texto.trim()}>
          {pending ? "A processar…" : "Enviar"}
        </button>
      </form>
      {linhas.length > 0 && (
        <button
          type="button"
          onClick={() => setLinhas([])}
          className="mt-3 text-xs text-paper/50 underline"
        >
          Limpar conversa
        </button>
      )}
    </div>
  );
}
