import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONFIRM_QUESTION, type PreviewField } from "@/lib/whatsapp/describe";
import {
  CAPTION_H,
  HALF_W,
  IMAGE_WIDTH,
  LINE_H,
  PAD,
  ROW_GAP,
  layoutPreview,
  loadPreview,
  type PreviewRow,
} from "@/lib/whatsapp/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A proposta do assistente de WhatsApp desenhada como o formulário do
 * backoffice, preenchido com o que vai ser gravado.
 *
 * Quem pede esta imagem é a Meta (e o simulador do backoffice), sem sessão: o
 * link assinado e com prazo é a credencial — ver preview-link.ts. Qualquer
 * coisa errada (assinatura, prazo, proposta já respondida) dá 404, sem dizer
 * porquê. E nunca fica em cache: a mesma proposta deixa de existir assim que a
 * pessoa responde.
 */

const NO_STORE = { "cache-control": "private, no-store, max-age=0" };

const notFound = () => new Response(null, { status: 404, headers: NO_STORE });

const INK = "#0A0A0A";
const PAPER = "#F5F5F4";
const MUTED = "rgba(245,245,244,0.55)";
const FIELD_BG = "#161616";
const BORDER = "rgba(255,255,255,0.14)";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = createAdminClient();
  if (!db) return notFound();
  const query = new URL(request.url).searchParams;
  const data = await loadPreview(db, id, query.get("exp"), query.get("sig"), new Date());
  if (!data) return notFound();

  const { rows, height } = layoutPreview(data.card);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: INK,
          color: PAPER,
          padding: PAD,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              color: data.accent,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            {data.companyName}
          </div>
          <div style={{ display: "flex", fontSize: 50, fontWeight: 700, marginTop: 14 }}>
            {data.card.title}
          </div>
          <div style={{ display: "flex", fontSize: 32, color: MUTED, marginTop: 10 }}>
            {data.card.subject}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 36, gap: ROW_GAP }}>
          {rows.map((row, i) => (
            <Row key={i} row={row} accent={data.accent} />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 36,
            paddingTop: 28,
            borderTop: `2px solid ${BORDER}`,
          }}
        >
          <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: data.accent }}>
            {CONFIRM_QUESTION}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: MUTED, marginTop: 10 }}>
            Nada fica gravado sem a sua resposta.
          </div>
        </div>
      </div>
    ),
    { width: IMAGE_WIDTH, height, headers: NO_STORE },
  );
}

function Label({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: 22,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: MUTED,
        marginBottom: 10,
      }}
    >
      {text}
    </div>
  );
}

/** Uma caixa como o `.field` do backoffice. */
function Box({ text, border, dim }: { text: string; border?: string; dim?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        background: FIELD_BG,
        border: `2px solid ${border ?? BORDER}`,
        borderRadius: 14,
        padding: "18px 22px",
        fontSize: 32,
        lineHeight: `${LINE_H}px`,
        color: dim ? MUTED : PAPER,
        textDecoration: dim ? "line-through" : "none",
      }}
    >
      {text}
    </div>
  );
}

function Field({ field, width }: { field: PreviewField; width?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", ...(width ? { width } : { flexGrow: 1 }) }}>
      <Label text={field.label} />
      <Box text={field.value} />
    </div>
  );
}

function Row({ row, accent }: { row: PreviewRow; accent: string }) {
  if (row.kind === "pair") {
    return (
      <div style={{ display: "flex", gap: ROW_GAP }}>
        {row.fields.map((f, i) => (
          <Field key={i} field={f} width={HALF_W} />
        ))}
      </div>
    );
  }
  if (row.kind === "full") return <Field field={row.field} />;
  // Uma alteração: o que está gravado (riscado) ao lado do que fica.
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Label text={row.field.label} />
      <div style={{ display: "flex", gap: ROW_GAP }}>
        <div style={{ display: "flex", flexDirection: "column", width: HALF_W }}>
          <div style={{ display: "flex", height: CAPTION_H, fontSize: 22, color: MUTED }}>Atual</div>
          <Box text={row.field.before} dim />
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: HALF_W }}>
          <div style={{ display: "flex", height: CAPTION_H, fontSize: 22, color: accent }}>Novo</div>
          <Box text={row.field.value} border={accent} />
        </div>
      </div>
    </div>
  );
}
