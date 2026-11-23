import type { SiteConfig } from "@/lib/site-config";

/**
 * Gestão → Configuração deste site: o projeto Supabase, as fotos e o domínio
 * a que este site está ligado, e as variáveis do Netlify (só se estão
 * preenchidas). Guia para um stand novo: docs/novo-projeto.md.
 */
export function SiteConfigCard({
  config,
  dbReady,
}: {
  config: SiteConfig;
  /** A base de dados tem a última migração (0057). */
  dbReady: boolean;
}) {
  const groups = [...new Set(config.vars.map((v) => v.group))];
  const facts: { label: string; value: string; ok: boolean; hint?: string }[] = [
    {
      label: "Base de dados (Supabase)",
      value: config.supabaseProject ? `projeto ${config.supabaseProject}` : "não configurada",
      ok: !!config.supabaseProject,
    },
    {
      label: "Instalação da base de dados",
      value: dbReady ? "atualizada" : "falta a migração 0057",
      ok: dbReady,
      hint: dbReady ? undefined : "Supabase → SQL Editor: supabase/migrations/0057_projeto_proprio.sql",
    },
    {
      label: "Fotos",
      value: config.mediaStorage === "r2" ? config.mediaUrl || "falta NEXT_PUBLIC_MEDIA_URL" : "Supabase Storage",
      ok: config.mediaStorage !== "r2" || !!config.mediaUrl,
    },
    { label: "Endereço do site", value: config.siteUrl, ok: !/localhost/.test(config.siteUrl) },
  ];

  return (
    <div className="card space-y-5 p-5">
      <ul className="grid gap-2 sm:grid-cols-2">
        {facts.map((f) => (
          <li key={f.label} className="flex gap-2 text-sm">
            <span aria-hidden className={f.ok ? "text-emerald-400" : "text-amber-300"}>
              {f.ok ? "✓" : "!"}
            </span>
            <span className="min-w-0">
              <span className="text-paper/60">{f.label}: </span>
              <span className="break-all text-paper">{f.value}</span>
              {f.hint && <span className="block text-xs text-paper/50">{f.hint}</span>}
            </span>
          </li>
        ))}
      </ul>

      {config.missingRequired.length > 0 && (
        <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
          Faltam variáveis obrigatórias no Netlify: <code>{config.missingRequired.join(", ")}</code>.
        </p>
      )}

      <details>
        <summary className="cursor-pointer text-sm text-accent">Variáveis do Netlify ({config.vars.filter((v) => v.set).length} de {config.vars.length} preenchidas)</summary>
        <div className="mt-3 space-y-4">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-paper/40">{g}</p>
              <ul className="space-y-1">
                {config.vars
                  .filter((v) => v.group === g)
                  .map((v) => (
                    <li key={v.name} className="flex gap-2 text-sm">
                      <span aria-hidden className={v.set ? "text-emerald-400" : v.required ? "text-red-400" : "text-paper/30"}>
                        {v.set ? "✓" : v.required ? "✕" : "–"}
                      </span>
                      <span className="min-w-0">
                        <code className="text-paper/85">{v.name}</code>
                        {v.required && !v.set && <span className="ml-2 text-xs text-red-300">obrigatória</span>}
                        <span className="block text-xs text-paper/45">{v.help}</span>
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
      <p className="text-xs text-paper/40">
        Só se mostra se cada variável está preenchida, nunca o valor. Para criar um site para outro stand (Supabase,
        Cloudflare R2 e Netlify próprios), siga o guia <code>docs/novo-projeto.md</code>.
      </p>
    </div>
  );
}
