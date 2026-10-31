"use client";

import { useEffect, useState } from "react";
import { ADMIN_THEME_KEY } from "./theme-init";

type Choice = "system" | "light" | "dark";

const KEY = ADMIN_THEME_KEY;
const SYNC_EVENT = "admin-theme-change";
const OPTIONS: { value: Choice; label: string; icon: string }[] = [
  { value: "system", label: "Sistema", icon: "◐" },
  { value: "light", label: "Claro", icon: "☀" },
  { value: "dark", label: "Escuro", icon: "☾" },
];

function stored(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Põe o tema já resolvido no <html>; o CSS do backoffice lê `data-admin-theme`. */
function apply(choice: Choice) {
  const light =
    choice === "light" || (choice === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.adminTheme = light ? "light" : "dark";
}

/**
 * Sistema / Claro / Escuro. Por defeito segue o sistema do utilizador (e
 * acompanha-o se mudar enquanto a página está aberta); a escolha fica guardada
 * só neste navegador. O script do layout aplica o mesmo antes da 1.ª pintura.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  // `null` até ler o que está guardado: assim o 1.º render não repõe o tema do
  // sistema por cima do que o script inicial já aplicou.
  const [choice, setChoice] = useState<Choice | null>(null);

  useEffect(() => {
    setChoice(stored());
    // Há mais de um seletor na página (topo e menu móvel): mantêm-se em sintonia.
    const sync = () => setChoice(stored());
    window.addEventListener(SYNC_EVENT, sync);
    return () => window.removeEventListener(SYNC_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!choice) return;
    apply(choice);
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  function pick(next: Choice) {
    setChoice(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* sem armazenamento (modo privado): vale só nesta sessão */
    }
    window.dispatchEvent(new Event(SYNC_EVENT));
  }
  const current = choice ?? "system";

  return (
    <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.06] p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={current === o.value}
          onClick={() => pick(o.value)}
          className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors ${
            current === o.value ? "bg-accent text-ink font-semibold" : "text-paper/60 hover:text-paper"
          }`}
        >
          <span aria-hidden>{o.icon}</span>
          {compact ? <span className="sr-only">{o.label}</span> : o.label}
        </button>
      ))}
    </div>
  );
}
