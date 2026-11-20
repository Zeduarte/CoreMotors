"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  copyMediaToR2,
  finishTestUpload,
  getMediaStorageStatus,
  getTestUploadTarget,
  testMediaStorage,
  type MediaStorageStatus,
  type StorageCheck,
} from "@/lib/actions/media-storage";

const BATCH = 4;

/**
 * Gestão → Fotos: onde estão as fotos (Supabase ou Cloudflare R2) e a
 * passagem para o R2, passo a passo: testar, copiar, ligar no Netlify.
 */
export function MediaStorageCard({ initial }: { initial: MediaStorageStatus }) {
  const [status, setStatus] = useState(initial);
  const [checks, setChecks] = useState<StorageCheck[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [failures, setFailures] = useState<{ path: string; error: string }[]>([]);

  const r2Ready = status.missing.length === 0;
  const copied = status.total - status.toCopy.length;
  const allCopied = r2Ready && status.toCopy.length === 0;

  async function refresh() {
    const s = await getMediaStorageStatus();
    setStatus(s);
    if (!s.ok && s.error) toast.error(s.error);
    return s;
  }

  async function test() {
    setTesting(true);
    try {
      const res = await testMediaStorage();
      const list = [...res.checks];
      if (res.checks.every((c) => c.ok) || res.checks.some((c) => c.label.startsWith("Gravar") && c.ok)) {
        // O browser também tem de conseguir carregar direto (regra CORS do bucket).
        const target = await getTestUploadTarget();
        let ok = false;
        if (target.ok && target.url) {
          try {
            const put = await fetch(target.url, { method: "PUT", body: "teste", headers: target.headers });
            ok = put.ok && (await finishTestUpload(target.path!)).ok;
          } catch {
            ok = false;
          }
        }
        list.push({
          label: "Carregar fotos a partir do backoffice (CORS)",
          ok,
          hint: ok ? undefined : "Falta a regra CORS no bucket (Settings → CORS Policy). Veja o guia, passo 2.",
        });
      }
      setChecks(list);
      if (list.every((c) => c.ok)) toast.success("Ligação ao Cloudflare R2 a funcionar.");
    } finally {
      setTesting(false);
    }
  }

  async function copy() {
    let todo = [...status.toCopy];
    const total = todo.length;
    let done = 0;
    const failed: { path: string; error: string }[] = [];
    setFailures([]);
    setProgress({ done, total, failed: 0 });
    while (todo.length) {
      const batch = todo.slice(0, BATCH);
      todo = todo.slice(BATCH);
      const res = await copyMediaToR2(batch).catch((e: unknown) => ({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        copied: 0,
        failed: batch.map((path) => ({ path, error: "pedido falhou" })),
      }));
      if (!res.ok && res.error && !res.failed.length) {
        toast.error(res.error);
        break;
      }
      done += res.copied;
      failed.push(...res.failed);
      setProgress({ done, total, failed: failed.length });
    }
    setFailures(failed);
    const s = await refresh();
    setProgress(null);
    if (!failed.length && s.toCopy.length === 0) toast.success("Fotos copiadas para o Cloudflare R2.");
    else toast.error(`${failed.length} ficheiro(s) não foram copiados. Pode tentar outra vez.`);
  }

  return (
    <div className="card space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-paper">
          Agora as fotos estão no{" "}
          <strong className="font-semibold">{status.active === "r2" ? "Cloudflare R2" : "Supabase"}</strong>.
        </p>
        <span className="text-sm text-paper/60">
          {status.total} ficheiro{status.total === 1 ? "" : "s"}
          {r2Ready ? ` · ${copied} no R2` : ""}
        </span>
      </div>

      {/* 1. Configuração */}
      <Step n={1} title="Ligar ao Cloudflare R2" done={r2Ready && !!checks?.every((c) => c.ok)}>
        {status.missing.length ? (
          <p className="text-sm text-paper/60">
            Faltam variáveis no Netlify: <code className="text-paper/80">{status.missing.join(", ")}</code>. Depois de
            as pôr, faça um novo deploy e volte aqui.
          </p>
        ) : (
          <p className="text-sm text-paper/60">
            Configurado{status.publicUrl ? ` (${status.publicUrl})` : ""}. Teste antes de copiar.
          </p>
        )}
        <button type="button" onClick={test} disabled={testing || !r2Ready} className="btn-ghost mt-3">
          {testing ? "A testar…" : "Testar ligação"}
        </button>
        {checks && (
          <ul className="mt-3 space-y-1.5 text-sm">
            {checks.map((c) => (
              <li key={c.label} className="flex gap-2">
                <span aria-hidden className={c.ok ? "text-emerald-400" : "text-red-400"}>
                  {c.ok ? "✓" : "✕"}
                </span>
                <span>
                  <span className="text-paper">{c.label}</span>
                  {c.hint && <span className="block text-xs text-paper/55">{c.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Step>

      {/* 2. Copiar */}
      <Step n={2} title="Copiar as fotos para o R2" done={allCopied}>
        <p className="text-sm text-paper/60">
          Copia do Supabase para o R2 as fotos que ainda lá não estão. Nada é apagado no Supabase. Pode repetir quantas
          vezes quiser.
        </p>
        {progress ? (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${progress.total ? Math.round(((progress.done + progress.failed) / progress.total) * 100) : 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-paper/60">
              {progress.done} de {progress.total} copiadas{progress.failed ? ` · ${progress.failed} com erro` : ""}… Não feche esta página.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={copy}
            disabled={!r2Ready || status.toCopy.length === 0}
            className="btn-primary mt-3"
          >
            {!r2Ready
              ? "Configure o R2 primeiro"
              : status.toCopy.length
                ? `Copiar ${status.toCopy.length} ficheiro${status.toCopy.length === 1 ? "" : "s"}`
                : "Tudo copiado"}
          </button>
        )}
        {failures.length > 0 && (
          <details className="mt-2 text-xs text-paper/55">
            <summary className="cursor-pointer">Ver os que falharam ({failures.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {failures.slice(0, 30).map((f) => (
                <li key={f.path}>
                  {f.path} — {f.error}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Step>

      {/* 3. Ligar */}
      <Step n={3} title="Passar o site a usar o R2" done={status.active === "r2" && allCopied}>
        {status.active === "r2" ? (
          <p className="text-sm text-paper/60">
            Feito: o site, o backoffice, o OLX e os catálogos já usam as fotos do R2. As fotos novas vão direto para lá.
            {status.toCopy.length > 0 && " Ainda há ficheiros só no Supabase: carregue em «Copiar»."}
          </p>
        ) : (
          <p className="text-sm text-paper/60">
            {allCopied ? "Tudo copiado. No Netlify, " : "Depois de copiar tudo, no Netlify, "}
            acrescente a variável <code className="text-paper/80">NEXT_PUBLIC_MEDIA_STORAGE</code> com o
            valor <code className="text-paper/80">r2</code> e faça um novo deploy. Depois volte aqui e carregue em
            «Copiar» mais uma vez (apanha as fotos que entraram entretanto).
          </p>
        )}
      </Step>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="flex gap-3">
      <span
        aria-hidden
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${
          done ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-paper/70"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-paper">{title}</h3>
        <div className="mt-1">{children}</div>
      </div>
    </section>
  );
}
