"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { MEDIA_BUCKET, MEDIA_CACHE_CONTROL, publicMediaUrl } from "@/lib/storage";
import { optimizePhoto } from "@/lib/image-compress";
import {
  deleteMedia,
  registerMedia,
  reorderMedia,
  setCover,
} from "@/lib/actions/media";

export interface MediaItem {
  id: string;
  storage_path: string;
  kind: "image" | "video";
  alt: string;
  is_cover: boolean;
  position: number;
}

// Aceita QUALQUER foto: as web-friendly entram diretas; HEIC/HEIF (iPhone) são
// convertidas para JPG no browser antes do upload. Vídeo continua mp4/webm
// (converter vídeo no browser seria pesado demais).
const WEB_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];
const ACCEPT = "image/*,video/mp4,video/webm,.heic,.heif";
const MAX_MB = 50;

function ext(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Devolve um ficheiro pronto a carregar (web-friendly), convertendo HEIC/HEIF
 * para JPG e reduzindo as fotos grandes (ver `optimizePhoto`). Devolve null
 * (com aviso) para o que não dá.
 */
async function normalizeFile(file: File): Promise<File | null> {
  const type = file.type.toLowerCase();
  const e = ext(file.name);

  // Vídeo
  if (type.startsWith("video/") || ["mp4", "webm", "mov", "avi", "mkv"].includes(e)) {
    if (VIDEO_TYPES.includes(type) || ["mp4", "webm"].includes(e)) return file;
    toast.error(`${file.name}: vídeo não suportado. Exporte em MP4.`);
    return null;
  }

  // Imagem já compatível com a web (reduzida, se for grande)
  if (WEB_IMAGE.includes(type) || ["jpg", "jpeg", "png", "webp", "avif", "gif"].includes(e)) {
    return optimizePhoto(file);
  }

  // HEIC/HEIF do iPhone → converte para JPG no browser
  if (type.includes("heic") || type.includes("heif") || ["heic", "heif"].includes(e)) {
    try {
      const heic2any = (await import("heic2any")).default;
      const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      const blob = Array.isArray(out) ? out[0]! : out;
      return optimizePhoto(
        new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
          type: "image/jpeg",
        }),
      );
    } catch {
      toast.error(`${file.name}: não foi possível converter a imagem.`);
      return null;
    }
  }

  // Outra imagem qualquer — tenta na mesma (o browser pode aguentar)
  if (type.startsWith("image/")) return optimizePhoto(file);

  toast.error(`${file.name}: formato não suportado.`);
  return null;
}

/** Lê dimensões de uma imagem no browser (evita CLS no site público). */
function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve({ width: 0, height: 0 });
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

export function MediaManager({
  carId,
  initial,
}: {
  carId: string;
  initial: MediaItem[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<MediaItem[]>(initial);
  const [uploading, setUploading] = useState(0); // nº de ficheiros a carregar
  const [dragOver, setDragOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const dragIndex = useRef<number | null>(null);

  const processFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      const all = fileList ? Array.from(fileList) : [];
      if (all.length === 0) return;

      setUploading((n) => n + all.length);

      // Normaliza (converte HEIC→JPG) sequencialmente para não sobrecarregar
      // o CPU; depois valida o tamanho do ficheiro final.
      const valid: File[] = [];
      for (const file of all) {
        const normalized = await normalizeFile(file);
        if (!normalized) continue;
        if (normalized.size > MAX_MB * 1024 * 1024) {
          toast.error(`${file.name}: excede ${MAX_MB}MB.`);
          continue;
        }
        valid.push(normalized);
      }
      if (valid.length === 0) {
        setUploading((n) => Math.max(0, n - all.length));
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
      try {
        // Upload em PARALELO (rápido), preservando a ordem de seleção.
        const results = await Promise.all(
          valid.map(async (file) => {
            const fileExt = ext(file.name) || "bin";
            const path = `${carId}/${crypto.randomUUID()}.${fileExt}`;
            const { error } = await supabase.storage
              .from(MEDIA_BUCKET)
              .upload(path, file, { cacheControl: MEDIA_CACHE_CONTROL, upsert: false });
            if (error) {
              toast.error(`Falha ao carregar ${file.name}.`);
              return null;
            }
            const { width, height } = await imageSize(file);
            return {
              storage_path: path,
              kind: file.type.startsWith("video/")
                ? ("video" as const)
                : ("image" as const),
              alt: "",
              width,
              height,
            };
          }),
        );

        const registered = results.filter(
          (r): r is NonNullable<typeof r> => r !== null,
        );
        if (registered.length === 0) return;

        const res = await registerMedia(carId, registered);
        if (res.ok) {
          toast.success(
            `${registered.length} ficheiro(s) adicionado(s).`,
          );
          router.refresh();
        } else {
          toast.error(res.error ?? "Erro ao registar media.");
        }
      } finally {
        setUploading((n) => Math.max(0, n - all.length));
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [carId, router, supabase],
  );

  // Colar (Cmd/Ctrl+V) imagens diretamente da área de transferência.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      const media = files.filter(
        (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
      );
      if (media.length > 0) {
        e.preventDefault();
        void processFiles(media);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [processFiles]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    void processFiles(e.dataTransfer.files);
  }

  // ---- Reordenação por drag ----
  function onCardDragStart(index: number) {
    dragIndex.current = index;
  }
  function onCardDrop(index: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === index) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved!);
    setItems(next);
    startTransition(async () => {
      const res = await reorderMedia(
        carId,
        next.map((m) => m.id).filter((id) => !id.startsWith("tmp-")),
      );
      if (!res.ok) toast.error("Não foi possível reordenar.");
      else router.refresh();
    });
  }

  function makeCover(id: string) {
    setItems((prev) => prev.map((m) => ({ ...m, is_cover: m.id === id })));
    startTransition(async () => {
      const res = await setCover(carId, id);
      if (res.ok) toast.success("Capa definida.");
      else toast.error("Erro ao definir capa.");
      router.refresh();
    });
  }

  // Apaga SEM confirmação (rápido). Remove logo do ecrã (otimista).
  function remove(id: string) {
    setItems((prev) => prev.filter((m) => m.id !== id));
    startTransition(async () => {
      const res = await deleteMedia(carId, id);
      if (res.ok) toast.success("Ficheiro apagado.");
      else {
        toast.error("Erro ao apagar.");
        router.refresh(); // repõe se falhou
      }
    });
  }

  // Mantém o estado local sincronizado quando o servidor devolve dados novos.
  useEffect(() => setItems(initial), [initial]);

  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-paper/50">
          Fotografias e vídeo
        </h2>
        <span className="text-xs text-paper/40">
          {items.length} ficheiro(s) · arraste para reordenar
        </span>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? "border-accent bg-accent/10"
            : "border-white/15 hover:border-white/30"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => processFiles(e.target.files)}
        />
        <p className="text-sm text-paper/70">
          {uploading > 0 ? (
            `A carregar ${uploading} ficheiro(s)…`
          ) : (
            <>
              <span className="font-medium text-paper">Clique</span>, arraste
              ou <span className="font-medium text-paper">cole (Cmd+V)</span>{" "}
              fotos / vídeo
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-paper/40">
          JPG, PNG, WebP, AVIF, MP4, WebM · até {MAX_MB}MB · vários ao mesmo
          tempo
        </p>
      </div>

      {/* Grelha */}
      {items.length > 0 && (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m, i) => (
            <li
              key={m.id}
              draggable
              onDragStart={() => onCardDragStart(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onCardDrop(i)}
              className="group relative aspect-[4/3] cursor-move overflow-hidden rounded-xl border border-white/10 bg-ink-muted"
            >
              <Thumb item={m} />

              {m.is_cover && (
                <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-ink">
                  Capa
                </span>
              )}
              {m.kind === "video" && (
                <span className="absolute left-2 bottom-2 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] text-paper">
                  ▶ Vídeo
                </span>
              )}

              {/* Ações — sempre com um X de apagar bem visível ao passar o rato */}
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(m.id)}
                aria-label="Apagar ficheiro"
                className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-red-500/90 text-sm font-bold text-white transition-opacity hover:bg-red-500 can-hover:opacity-0 group-hover:opacity-100"
              >
                ✕
              </button>

              {m.kind === "image" && !m.is_cover && (
                <div className="absolute inset-x-0 bottom-0 flex bg-gradient-to-t from-ink/90 to-transparent p-2 transition-opacity can-hover:opacity-0 group-hover:opacity-100">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => makeCover(m.id)}
                    className="rounded bg-white/15 px-2 py-1 text-[10px] font-medium text-paper hover:bg-white/25"
                  >
                    Definir capa
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Miniatura tolerante a falhas: se a imagem não carregar (ex.: HEIC antigo já
 * guardado), mostra um cartão de aviso em vez do ícone partido — e o ficheiro
 * continua a poder ser apagado.
 */
function Thumb({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false);
  const url = publicMediaUrl(item.storage_path);

  if (item.kind === "video") {
    return failed ? (
      <Fallback label="Vídeo" />
    ) : (
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    );
  }

  return failed ? (
    <Fallback label="Pré-visualização indisponível" />
  ) : (
    // Miniatura pela CDN de imagens (como no site), nunca o original: cada
    // foto original tem MBs e abrir uma viatura descarregava-as todas do
    // Supabase de cada vez — era a maior parte do tráfego ("egress").
    <Image
      src={url}
      alt={item.alt || "Media da viatura"}
      fill
      sizes="240px"
      onError={() => setFailed(true)}
      className="object-cover"
    />
  );
}

function Fallback({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-white/5 p-2 text-center">
      <span className="text-lg" aria-hidden>
        🚫
      </span>
      <span className="text-[10px] leading-tight text-paper/50">{label}</span>
    </div>
  );
}
