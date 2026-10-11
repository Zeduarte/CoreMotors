import { getCurrentProfile } from "@/lib/admin-queries";
import { canAccess } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode, olxConfigured, olxFetch } from "@/lib/olx/client";
import { verifyState } from "@/lib/olx/oauth";
import { unwrap } from "@/lib/olx/categories";
import { localRedirect } from "@/lib/local-redirect";
import { STATE_COOKIE, olxRedirectUri } from "../redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retorno do OAuth do OLX. Troca o `code` por tokens e guarda a ligação.
 *
 * O `state` é verificado contra o cookie deste navegador ANTES de se tocar no
 * `code`: sem isso, um link forjado podia ligar o site à conta do OLX de outra
 * pessoa, e os anúncios do stand iam parar lá.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const done = (estado: string, detalhe?: string) => {
    const q = new URLSearchParams({ olx: estado });
    if (detalhe) q.set("detalhe", detalhe.slice(0, 200));
    const r = localRedirect(`/admin/anuncios?${q}`);
    r.cookies.delete({ name: STATE_COOKIE, path: "/api/olx" });
    return r;
  };

  const me = await getCurrentProfile();
  if (!me || !canAccess(me.role, me.allowed_sections, "anuncios")) {
    return localRedirect("/admin/login");
  }
  if (!olxConfigured()) return done("sem-credenciais");

  // O OLX devolve `error` quando a pessoa recusa a autorização.
  if (url.searchParams.get("error")) return done("recusado", url.searchParams.get("error") ?? "");

  const cookie = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1) ?? null;
  if (!verifyState(url.searchParams.get("state"), cookie ? decodeURIComponent(cookie) : null, process.env.OLX_CLIENT_SECRET!)) {
    return done("estado-invalido");
  }

  const code = url.searchParams.get("code");
  if (!code) return done("erro", "o OLX não devolveu o código de autorização");

  const db = createAdminClient();
  if (!db) return done("erro", "SUPABASE_SERVICE_ROLE_KEY em falta");

  try {
    const tokens = await exchangeCode(code, olxRedirectUri());
    const { error } = await db.from("olx_connection").upsert({
      id: 1,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      connected_by: me.id,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) return done("erro", "não foi possível guardar a ligação — aplicou a migração 0025?");

    // Quem é a conta ligada, para o painel mostrar o nome certo.
    const user = await olxFetch<unknown>(db, "/users/me");
    if (user.ok) {
      const u = unwrap<{ id?: number; name?: string; email?: string }>(user.data) ?? {};
      await db
        .from("olx_connection")
        .update({ olx_user_id: u.id ? String(u.id) : null, olx_user_name: u.name || u.email || null })
        .eq("id", 1);
    }
    return done("ligado");
  } catch (e) {
    console.error("olx callback:", e);
    return done("erro", e instanceof Error ? e.message : "falha ao ligar");
  }
}
