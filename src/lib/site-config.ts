import "server-only";
import envVars from "@/config/env-vars.json";
import { mediaStorage, r2PublicBase } from "@/lib/storage";
import { site } from "@/lib/site";

/**
 * Configuração deste site (Gestão): a que projeto Supabase, bucket R2 e
 * domínio está ligado, e que variáveis do Netlify tem. Só os NOMES das
 * variáveis e se estão preenchidas — nunca os valores. Serve para confirmar,
 * num stand novo, que está ligado às coisas dele e não às de outro.
 */

export interface EnvStatus {
  name: string;
  group: string;
  required: boolean;
  set: boolean;
  help: string;
}

export interface SiteConfig {
  supabaseProject: string | null;
  mediaUrl: string;
  mediaStorage: "supabase" | "r2";
  siteUrl: string;
  vars: EnvStatus[];
  missingRequired: string[];
}

export function siteConfig(): SiteConfig {
  const usesR2 = mediaStorage() === "r2";
  const vars = (envVars.vars as { name: string; group: string; required: boolean | string; help: string }[]).map((v) => ({
    name: v.name,
    group: v.group,
    // R2_ENDPOINT (só em testes) substitui o endereço da conta.
    required: (v.required === true || (v.required === "r2" && usesR2)) && !(v.name === "R2_ACCOUNT_ID" && process.env.R2_ENDPOINT),
    set: !!(process.env[v.name] ?? "").trim(),
    help: v.help,
  }));
  const supa = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return {
    supabaseProject: /^https:\/\/([a-z0-9-]+)\.supabase\./.exec(supa)?.[1] ?? null,
    mediaUrl: r2PublicBase(),
    mediaStorage: mediaStorage(),
    siteUrl: site.url,
    vars,
    missingRequired: vars.filter((v) => v.required && !v.set).map((v) => v.name),
  };
}
