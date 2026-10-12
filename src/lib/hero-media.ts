import "server-only";
import { mediaDir } from "@/lib/media";
import manifest from "@/lib/media-manifest.json";
import type { VehicleType } from "@/lib/vehicle-categories";

/**
 * Média do topo da página inicial, detetada pelo ficheiro que existir na pasta
 * do mundo (`public/media/carros/` ou `public/media/motas/`):
 *  - existe `topo.mp4`                  → vídeo (controlado pelo scroll)
 *  - existe `topo.jpg|png|webp|avif`    → imagem fixa
 *  - nada                               → vídeo, que mostra o `topo-poster.jpg`
 *
 * Assim o dono do site troca entre vídeo e imagem só substituindo o ficheiro,
 * sem mexer no código. A deteção usa `media-manifest.json`, gerado no build
 * (scripts/media-manifest.mjs) — nunca o disco: ler `public/` com um caminho
 * variável fazia o Next meter a pasta inteira na função do Netlify (>250 MB).
 */
export type HeroMedia =
  | { type: "video"; src: string; poster: string }
  // `src2` (opcional): 2ª imagem que aparece por cima ao fazer scroll
  // (cross-fade). Útil p/ efeitos tipo "semáforo vermelho -> verde".
  | { type: "image"; src: string; src2?: string };

const EXISTING = new Set<string>(manifest);

/**
 * Caminho público de um ficheiro opcional do mundo (`OPTIONAL_MEDIA`), ou null
 * se não existir — para o site não pedir ficheiros que não estão lá.
 */
export function existingMedia(type: VehicleType, file: string): string | null {
  const rel = `${mediaDir(type)}/${file}`;
  return EXISTING.has(rel) ? rel : null;
}

const EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif"];

function firstExisting(dir: string, base: string): string | null {
  for (const ext of EXTENSIONS) {
    const name = `${base}.${ext}`;
    if (EXISTING.has(`${dir}/${name}`)) return `${dir}/${name}`;
  }
  return null;
}

function video(dir: string): HeroMedia {
  return { type: "video", src: `${dir}/topo.mp4`, poster: `${dir}/topo-poster.jpg` };
}

/** Imagem do topo (com 2ª imagem opcional p/ cross-fade), ou null. */
function imageMedia(dir: string): HeroMedia | null {
  const src = firstExisting(dir, "topo");
  if (!src) return null;
  const src2 = firstExisting(dir, "topo-2");
  return src2 ? { type: "image", src, src2 } : { type: "image", src };
}

/**
 * Média do topo. `mode` vem da definição do backoffice (Página inicial):
 *  - "video" → força o vídeo (sem `topo.mp4`, cai para a imagem);
 *  - "image" → força a imagem (se não existir ficheiro, cai para o vídeo);
 *  - "auto"  → deteta pelo ficheiro (mp4 primeiro, senão imagem, senão vídeo).
 */
export function getHeroMedia(
  mode: "auto" | "video" | "image" = "auto",
  type: VehicleType = "car",
): HeroMedia {
  const dir = mediaDir(type);
  // Vídeo escolhido mas sem o ficheiro: mostra a imagem, se houver.
  if (mode === "video") return EXISTING.has(`${dir}/topo.mp4`) ? video(dir) : (imageMedia(dir) ?? video(dir));

  if (mode === "image") return imageMedia(dir) ?? video(dir);
  // auto
  if (EXISTING.has(`${dir}/topo.mp4`)) return video(dir);
  return imageMedia(dir) ?? video(dir);
}
