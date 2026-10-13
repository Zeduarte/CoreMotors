"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PHOTOS_PER_BATCH } from "@/lib/storage";
import {
  deletePhotoBackups,
  optimizePhotos,
  refreshPhotoCache,
  scanPhotos,
  type PhotoScan,
} from "@/lib/actions/photos";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)} MB`;

/**
 * "Otimizar fotos" (Definições): reduz as fotos que já estão no site, no
 * próprio servidor — sem instalar nada nem mexer em chaves. Primeiro analisa
 * (só lê os tamanhos), depois reduz uma de cada vez com uma barra de
 * progresso; pode fechar-se a página a meio e continuar mais tarde.
 */
export function PhotoOptimizer() {
  const [scan, setScan] = useState<PhotoScan | null>(null);
  const [busy, setBusy] = useState<"scan" | "run" | "delete" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, before: 0, after: 0, errors: 0 });

  async function analyse() {
    setBusy("scan");
    try {
      const r = await scanPhotos();
      if (!r.ok) toast.error(r.error ?? "Não foi possível analisar as fotos.");
      setScan(r);
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!scan || !(scan.todo.length + scan.stale.length)) return;
    setBusy("run");
    const ids = scan.todo.map((t) => t.id);
    const p = { done: 0, total: ids.length + scan.stale.length, before: 0, after: 0, errors: 0 };
    setProgress({ ...p });
    try {
      for (let i = 0; i < ids.length; i += PHOTOS_PER_BATCH) {
        const batch = ids.slice(i, i + PHOTOS_PER_BATCH);
        let res: Awaited<ReturnType<typeof optimizePhotos>> | null = null;
        try {
          res = await optimizePhotos(batch);
        } catch {
          // Pedido que demorou demais: tenta uma a uma.
          for (const id of batch) {
            try {
              const one = await optimizePhotos([id]);
              res = { ok: true, results: [...(res?.results ?? []), ...one.results] };
            } catch {
              p.errors++;
            }
          }
        }
        for (const r of res?.results ?? []) {
          p.before += r.before;
          p.after += r.after;
          if (r.status === "erro") p.errors++;
        }
        p.done = Math.min(ids.length, i + batch.length);
        setProgress({ ...p });
      }
      // Depois, as leves com cache curta: regravam-se iguais, com cache de 1 ano.
      for (const { id } of scan.stale) {
        try {
          const r = await refreshPhotoCache([id]);
          if (!r.ok || !r.done) p.errors++;
        } catch {
          p.errors++;
        }
        p.done++;
        setProgress({ ...p });
      }
      toast.success(ids.length ? `Fotos reduzidas: ${mb(p.before)} → ${mb(p.after)}.` : "Fotos atualizadas.");
    } finally {
      setBusy(null);
      await analyse();
    }
  }

  async function removeBackups() {
    if (!confirm("Apagar as cópias dos originais? Depois disto as fotos reduzidas ficam definitivas.")) return;
    setBusy("delete");
    try {
      const r = await deletePhotoBackups();
      if (r.ok) toast.success(`${r.removed} cópias apagadas.`);
      else toast.error(r.error ?? "Não foi possível apagar as cópias.");
    } finally {
      setBusy(null);
      await analyse();
    }
  }

  const heavy = scan?.todo.reduce((a, t) => a + t.size, 0) ?? 0;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-ink-soft p-5">
      <p className="text-sm text-paper/70">
        Reduz as fotos das viaturas que já estão no site para o tamanho que o site mostra (no máximo 2400 px),
        sem diferença visível. As fotos ficam muito mais leves e o site carrega-as mais depressa. As fotos novas
        já sobem reduzidas.
      </p>

      {!scan && (
        <button type="button" className="btn-primary" onClick={analyse} disabled={busy !== null}>
          {busy === "scan" ? "A analisar…" : "Analisar fotos"}
        </button>
      )}

      {scan?.ok && busy !== "run" && (
        <div className="space-y-3 text-sm text-paper/80">
          {scan.todo.length + scan.stale.length ? (
            <>
              {scan.todo.length > 0 && (
                <p>
                  <strong className="text-paper">{scan.todo.length}</strong> de {scan.total} fotos estão pesadas (
                  {mb(heavy)} no total).
                </p>
              )}
              {scan.stale.length > 0 && (
                <p>
                  <strong className="text-paper">{scan.stale.length}</strong> fotos leves ainda estão guardadas com
                  cache de 1 hora (o site volta a pedi-las ao Supabase a cada hora) — passam a 1 ano.
                </p>
              )}
              <button type="button" className="btn-primary" onClick={run} disabled={busy !== null}>
                {scan.todo.length ? `Reduzir ${scan.todo.length} fotos` : "Atualizar fotos"}
                {scan.todo.length > 0 && scan.stale.length > 0 && ` e atualizar ${scan.stale.length}`}
              </button>
              <p className="text-xs text-paper/50">
                Antes de reduzir, cada original é copiado para uma pasta de segurança. Pode fechar a página a meio:
                ao voltar, continua das que faltam.
              </p>
            </>
          ) : (
            <p>✓ Todas as {scan.total} fotos já estão leves e com cache longa.</p>
          )}
        </div>
      )}

      {busy === "run" && (
        <div className="space-y-2" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-paper/70">
            {progress.done} / {progress.total} fotos · {mb(progress.before)} → {mb(progress.after)}
            {progress.errors > 0 && ` · ${progress.errors} com erro`}
          </p>
          <p className="text-xs text-paper/50">Não feche esta página até terminar.</p>
        </div>
      )}

      {scan?.ok && scan.backups.count > 0 && busy !== "run" && (
        <div className="space-y-2 border-t border-white/10 pt-4 text-sm text-paper/70">
          <p>
            Há {scan.backups.count} cópias dos originais guardadas ({mb(scan.backups.size)}). Quando confirmar que as
            fotos no site estão bem, apague-as para libertar espaço no Supabase.
          </p>
          <button type="button" className="btn-ghost" onClick={removeBackups} disabled={busy !== null}>
            {busy === "delete" ? "A apagar…" : "Apagar cópias dos originais"}
          </button>
        </div>
      )}
    </div>
  );
}
