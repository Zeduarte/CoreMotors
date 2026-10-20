import "server-only";
import { headers } from "next/headers";
import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type SubmissionKind =
  | "lead"
  | "testimonial"
  | "view"
  | "reviews"
  | "chat"
  | "whatsapp";

/** Tetos por janela de 10 minutos: [global, por IP, por identidade]. */
const QUOTAS: Record<SubmissionKind, [number, number, number]> = {
  lead: [100, 10, 5],
  testimonial: [100, 10, 5],
  reviews: [100, 10, 5],
  view: [3000, 120, 30],
  // O chat custa dinheiro por mensagem — teto mais alto que um formulário,
  // mas bem abaixo do que seria preciso para inflacionar a fatura.
  chat: [300, 30, 30],
  // Ordens do WhatsApp: a identidade é o telefone (fica em hash, como as
  // outras). O teto por IP é igual ao global de propósito — quem chama é
  // sempre a Meta, e um teto por IP baixo bloquearia todos os colaboradores de
  // uma vez.
  whatsapp: [500, 500, 40],
};

let warnedMissingIp = false;
/**
 * Sem IP fiável o limite por IP não existe (ficam só o global e o por
 * identidade). Em produção avisa uma vez por processo; não muda o comportamento.
 */
function warnMissingClientIp(header: string | undefined) {
  if (warnedMissingIp || process.env.NODE_ENV !== "production") return;
  warnedMissingIp = true;
  console.warn(
    header
      ? `[public-submissions] O header "${header}" (TRUSTED_CLIENT_IP_HEADER) não veio no pedido: sem limite por IP.`
      : "[public-submissions] TRUSTED_CLIENT_IP_HEADER não está definido: sem limite por IP nas submissões públicas. Recomendado em produção (Netlify: x-nf-client-connection-ip).",
  );
}

/** Only the server can write public submissions; RLS denies direct anonymous inserts. */
export async function publicSubmissionClient(
  kind: SubmissionKind,
  identity = "",
) {
  const db = createAdminClient();
  if (!db)
    throw new Error(
      "Submissões temporariamente indisponíveis. Contacte-nos por telefone.",
    );
  const h = await headers();
  // Only trust an explicitly configured ingress header that the hosting proxy overwrites.
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  const ip = header ? h.get(header)?.split(",")[0]?.trim() : null;
  if (!ip) warnMissingClientIp(header);
  const secret =
    process.env.SUBMISSION_HASH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const hash = (value: string) =>
    createHmac("sha256", secret).update(value).digest("hex");
  const [globalMax, ipMax, identityMax] = QUOTAS[kind];
  const keys = [{ value: `${kind}:global`, max: globalMax }];
  if (ip) keys.push({ value: `${kind}:ip:${hash(ip)}`, max: ipMax });
  if (identity)
    keys.push({
      value: `${kind}:identity:${hash(identity.toLowerCase())}`,
      max: identityMax,
    });
  for (const key of keys) {
    const { data, error } = await db.rpc("consume_submission", {
      key_value: key.value,
      max_hits: key.max,
      window_seconds: 600,
    });
    if (error || !data)
      throw new Error(
        "Demasiados pedidos. Aguarde alguns minutos e tente novamente.",
      );
  }
  return db;
}
