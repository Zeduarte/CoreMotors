/**
 * Reduz uma foto no browser antes de subir para o Supabase.
 *
 * O site nunca mostra uma foto com mais de ~2400 px de largura (galeria a
 * toda a largura num ecrã retina), e o Netlify ainda a converte para
 * WebP/AVIF no tamanho de cada ecrã. Uma foto de telemóvel (4000–6000 px,
 * 4–8 MB) é por isso sobretudo peso morto: atrasa o upload, a primeira
 * abertura de cada foto no site e os anúncios que levam o original.
 *
 * Fica em JPEG (os portais de anúncios, como o OLX, aceitam-no sempre) com
 * qualidade alta — a diferença não se vê. Se o resultado não ficar mais
 * pequeno, segue o original. GIF e SVG seguem sem mexer.
 */
export const MAX_PHOTO_SIDE = 2400;
const QUALITY = 0.85;
/** Abaixo disto (e dentro do tamanho máximo) não vale a pena recomprimir. */
const SMALL_ENOUGH = 600 * 1024;

export async function optimizePhoto(file: File): Promise<File> {
  const type = file.type.toLowerCase();
  if (!type.startsWith("image/") || type === "image/gif" || type === "image/svg+xml") return file;

  let bitmap: ImageBitmap;
  try {
    // `from-image`: respeita a rotação EXIF (fotos de telemóvel ao alto).
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // formato que o browser não lê: segue tal como está
  }

  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(width, height));
  if (scale === 1 && file.size <= SMALL_ENOUGH) {
    bitmap.close();
    return file;
  }

  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  // PNG com transparência: fundo branco em vez de preto no JPEG.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}
