"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSiteTheme } from "@/lib/actions/gestao";
import { SITE_MODES, SITE_MODE_LABELS, type MobileMenu, type SiteMode, type ThemeId, type ThemeNote } from "@/themes/index";

const MODE_HINT: Record<SiteMode, string> = {
  dark: "O de sempre: fundo preto.",
  light: "O mesmo site, com fundo branco.",
  system: "Escuro ou claro, conforme o sistema do dispositivo de quem visita.",
};

/**
 * Gestão → Versão do site: um cartão por tema (Core, Core2, Core3). Em cada
 * um, a aparência: Escuro, Claro ou Automático (segue o sistema do
 * dispositivo). O tema escolhido mostra o que muda no backoffice com ele.
 */
export function SiteThemeForm({
  initial,
  initialModes,
  initialMobileMenu,
  themes,
}: {
  initial: ThemeId;
  initialModes: Record<ThemeId, SiteMode>;
  initialMobileMenu: MobileMenu;
  themes: { id: ThemeId; label: string; description: string; notes?: ThemeNote[] }[];
}) {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemeId>(initial);
  const [modes, setModes] = useState<Record<ThemeId, SiteMode>>(initialModes);
  const [mobileMenu, setMobileMenu] = useState<MobileMenu>(initialMobileMenu);
  const [pending, start] = useTransition();
  const selectedNotes = themes.find((t) => t.id === theme)?.notes ?? [];
  const changed = theme !== initial || themes.some((t) => modes[t.id] !== initialModes[t.id]) || mobileMenu !== initialMobileMenu;

  function save() {
    start(async () => {
      const r = await saveSiteTheme(theme, modes, mobileMenu);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível guardar.");
        return;
      }
      toast.success("Versão do site guardada. O site público já usa a nova versão.");
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4 p-5">
      <div role="group" aria-label="Versão do site" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {themes.map((t) => {
          const on = t.id === theme;
          return (
            <div
              key={t.id}
              className={`rounded-2xl border p-4 transition-colors ${
                on
                  ? "border-[color:var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <button type="button" aria-pressed={on} onClick={() => setTheme(t.id)} className="block w-full text-left">
                <span className="flex items-center gap-2 font-semibold text-paper">
                  <span
                    aria-hidden
                    className={`grid h-4 w-4 place-items-center rounded-full border ${
                      on ? "border-[color:var(--accent)]" : "border-white/20"
                    }`}
                  >
                    {on && <span className="h-2 w-2 rounded-full bg-accent" />}
                  </span>
                  {t.label}
                  {t.id === initial && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-paper/60">
                      Em uso
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs text-paper/55">{t.description}</span>
              </button>

              <div role="group" aria-label={`Aparência do ${t.label}`} className="mt-4 grid grid-cols-3 gap-1 rounded-full border border-white/10 p-1">
                {SITE_MODES.map((m) => {
                  const picked = modes[t.id] === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={picked}
                      onClick={() => setModes((prev) => ({ ...prev, [t.id]: m }))}
                      className={`rounded-full px-2 py-1.5 text-xs font-semibold transition-colors ${
                        picked ? "bg-paper text-ink" : "text-paper/65 hover:text-paper"
                      }`}
                    >
                      {SITE_MODE_LABELS[m]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-paper/45">{MODE_HINT[modes[t.id]]}</p>

              {t.id === "core3" && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-paper/70">Menu no telemóvel</p>
                  <div role="group" aria-label="Menu no telemóvel" className="mt-1.5 grid grid-cols-2 gap-1 rounded-full border border-white/10 p-1">
                    {(["top", "bottom"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={mobileMenu === m}
                        onClick={() => setMobileMenu(m)}
                        className={`rounded-full px-2 py-1.5 text-xs font-semibold transition-colors ${
                          mobileMenu === m ? "bg-paper text-ink" : "text-paper/65 hover:text-paper"
                        }`}
                      >
                        {m === "top" ? "Em cima" : "Em baixo"}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-paper/45">
                    {mobileMenu === "top"
                      ? "Os 3 traços no cabeçalho abrem o menu."
                      : "Sem os 3 traços: Motas · Moto 4 · Carros · Vender · Contactos numa barra em baixo, em todas as páginas."}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {selectedNotes.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
          <p className="font-semibold text-paper">O que muda com o {themes.find((t) => t.id === theme)?.label}</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-paper/65">
            {selectedNotes.map((n) => (
              <li key={n.text}>
                {n.text}
                {n.href && (
                  <>
                    {" "}
                    <a href={n.href} className="text-accent hover:underline">
                      {n.link ?? "Abrir"} →
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a href="/" target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
          Ver o site ↗
        </a>
        <button type="button" onClick={save} disabled={pending || !changed} className="btn-primary">
          {pending ? "A guardar…" : "Guardar versão"}
        </button>
      </div>
    </div>
  );
}
