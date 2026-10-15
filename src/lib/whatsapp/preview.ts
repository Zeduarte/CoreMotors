import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { PendingActionSchema, type PendingAction } from "@/lib/whatsapp/actions";
import { isUsable } from "@/lib/whatsapp/confirm";
import { previewCard, type PreviewCard, type PreviewField } from "@/lib/whatsapp/describe";
import { previewSecret, verifyPreview } from "@/lib/whatsapp/preview-link";
import { photoThumbnails } from "@/lib/whatsapp/thumbnails";

/**
 * O que a rota da imagem (`/api/whatsapp/preview/[id]`) precisa, sem o
 * desenho: quem pode ver e o que se mostra. Vive aqui, e não na rota, para ser
 * testado sem o Next — é aqui que se decide se um link vale.
 */

export interface PreviewData {
  card: PreviewCard;
  companyName: string;
  accent: string;
}

const DEFAULT_ACCENT = "#E8B15A";

/**
 * Só devolve alguma coisa com assinatura certa, dentro do prazo, e para uma
 * proposta AINDA pendente e por caducar. Tudo o resto é `null` (404), sem
 * distinguir porquê. Nunca lança.
 */
export async function loadPreview(
  db: SupabaseClient<Database>,
  id: string,
  exp: string | null,
  sig: string | null,
  now: Date,
  secret: string = previewSecret(),
): Promise<PreviewData | null> {
  try {
    // A assinatura primeiro: um pedido forjado não chega à base de dados.
    if (!verifyPreview(id, exp, sig, now, secret)) return null;
    const { data } = await db
      .from("wa_pending_actions")
      .select("payload,status,expires_at")
      .eq("id", id)
      .maybeSingle();
    if (!data || !isUsable(data, now)) return null;
    const parsed = PendingActionSchema.safeParse(data.payload);
    if (!parsed.success) return null;
    const { data: brand } = await db
      .from("site_settings")
      .select("company_name,accent")
      .eq("id", 1)
      .maybeSingle();
    const action = parsed.data as PendingAction;
    const card = previewCard(action);
    // As fotografias a juntar, desenhadas a partir do bucket privado (0039).
    if (action.kind === "add_car_media") card.photos = await photoThumbnails(db, action.fotos, MAX_THUMBS);
    return {
      card: safeCard(card),
      companyName: imageText(brand?.company_name || "Backoffice", 60),
      accent: /^#[0-9a-f]{6}$/i.test(brand?.accent ?? "") ? brand!.accent : DEFAULT_ACCENT,
    };
  } catch {
    return null;
  }
}

/**
 * O tipo de letra da imagem (o de origem do `next/og`) só cobre o alfabeto
 * latino. Um carácter que lá não esteja (emoji, outra escrita) faria o motor
 * ir buscar fontes à rede, a meio da resposta à Meta — por isso sai daqui. A
 * imagem é uma ajuda para ler; o texto completo vai na legenda.
 */
export function imageText(value: string, max: number): string {
  const flat = value
    .replace(/[^ -ɏ -⁯€\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Valor longo no máximo em ~5 linhas; cabeçalhos numa ou duas. */
const MAX_VALUE = 260;

function safeCard(card: PreviewCard): PreviewCard {
  // Só miniaturas geradas por nós (JPEG em base64): nada que o motor vá buscar à rede.
  const photos = card.photos?.filter((p) => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p));
  return {
    ...(photos?.length ? { photos } : {}),
    title: imageText(card.title, 60),
    subject: imageText(card.subject, 90),
    fields: card.fields.map((f) => ({
      label: imageText(f.label, 40),
      value: imageText(f.value, MAX_VALUE) || "—",
      ...(f.before !== undefined ? { before: imageText(f.before, MAX_VALUE) || "—" } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Medidas (a rota desenha; aqui decide-se o tamanho, para nada ficar cortado)
// ---------------------------------------------------------------------------

export const IMAGE_WIDTH = 1080;
export const PAD = 56;
export const ROW_GAP = 24;
export const LINE_H = 42;
/** A legenda «Atual» / «Novo» por cima das caixas de uma alteração. */
export const CAPTION_H = 32;
/** Largura de meia coluna (dois campos lado a lado). */
export const HALF_W = (IMAGE_WIDTH - 2 * PAD - ROW_GAP) / 2;
/** Caracteres por linha, por baixo (a letra varia): mais linhas = nunca cortado. */
const CHARS_FULL = 48;
const CHARS_HALF = 20;

/** Miniaturas das fotografias: quatro por linha, no máximo três linhas. */
export const PHOTO_COLS = 4;
export const PHOTO_GAP = 16;
export const MAX_THUMBS = 12;
export const PHOTO_SIZE = Math.floor((IMAGE_WIDTH - 2 * PAD - (PHOTO_COLS - 1) * PHOTO_GAP) / PHOTO_COLS);

/** Altura do bloco das miniaturas (rótulo incluído), ou 0. */
export function photosHeight(count: number): number {
  if (!count) return 0;
  const rows = Math.ceil(Math.min(count, MAX_THUMBS) / PHOTO_COLS);
  return 28 + 10 + rows * PHOTO_SIZE + (rows - 1) * PHOTO_GAP + ROW_GAP;
}

export type PreviewRow =
  | { kind: "pair"; fields: PreviewField[] }
  | { kind: "change"; field: PreviewField & { before: string } }
  | { kind: "full"; field: PreviewField };

function lines(text: string, perLine: number): number {
  return Math.max(1, Math.ceil(text.length / perLine));
}

/** Um campo curto ocupa meia largura, ao lado de outro — como no formulário. */
function isShort(f: PreviewField): boolean {
  return f.before === undefined && f.value.length <= CHARS_HALF && f.label.length <= 24;
}

export function layoutPreview(card: PreviewCard): { rows: PreviewRow[]; height: number } {
  const rows: PreviewRow[] = [];
  let par: PreviewField[] = [];
  const flush = () => {
    if (par.length) rows.push({ kind: "pair", fields: par });
    par = [];
  };
  for (const f of card.fields) {
    if (isShort(f)) {
      par.push(f);
      if (par.length === 2) flush();
      continue;
    }
    flush();
    if (f.before !== undefined) rows.push({ kind: "change", field: { ...f, before: f.before } });
    else rows.push({ kind: "full", field: f });
  }
  flush();

  const box = (n: number) => 28 + 10 + 36 + n * LINE_H + 4;
  let height = PAD * 2;
  height += 30 + 14 + 60 + 10 + lines(card.subject, 44) * 40 + 36; // cabeçalho
  for (const row of rows) {
    const n =
      row.kind === "pair"
        ? Math.max(...row.fields.map((f) => lines(f.value, CHARS_HALF)))
        : row.kind === "change"
          ? Math.max(lines(row.field.value, CHARS_HALF), lines(row.field.before, CHARS_HALF))
          : lines(row.field.value, CHARS_FULL);
    // Uma alteração leva por cima de cada caixa «Atual» / «Novo».
    height += box(n) + ROW_GAP + (row.kind === "change" ? CAPTION_H : 0);
  }
  height += photosHeight(card.photos?.length ?? 0);
  height += 36 + 2 + 28 + 44 + 10 + 30 + 40; // rodapé e folga
  return { rows, height: Math.min(2800, Math.ceil(height)) };
}
