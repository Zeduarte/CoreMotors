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

/**
 * As quotas a gastar, pela ordem em que se pedem: por IP, por identidade e a
 * global no fim. Cada uma só se gasta se as anteriores passaram (e a 0045 não
 * conta um pedido recusado), por isso a global só conta pedidos aceites pelos
 * limites de quem os fez.
 */
export function submissionKeys(
  kind: SubmissionKind,
  ipHash: string | null,
  identityHash: string | null,
) {
  const [globalMax, ipMax, identityMax] = QUOTAS[kind];
  const keys: { value: string; max: number }[] = [];
  if (ipHash) keys.push({ value: `${kind}:ip:${ipHash}`, max: ipMax });
  if (identityHash)
    keys.push({ value: `${kind}:identity:${identityHash}`, max: identityMax });
  keys.push({ value: `${kind}:global`, max: globalMax });
  return keys;
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
  // A global vai em último: quem é travado pelo seu próprio limite (IP ou
  // identidade) para antes de a gastar, e não bloqueia o site a toda a gente.
  const keys = submissionKeys(
    kind,
    ip ? hash(ip) : null,
    identity ? hash(identity.toLowerCase()) : null,
  );
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
