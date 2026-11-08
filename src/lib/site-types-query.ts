import "server-only";
import type { VehicleType } from "@/lib/vehicle-categories";
import { cachedPublic, safely } from "@/lib/public-cache";
import { supabasePublic } from "@/lib/supabase/public";
import { DEFAULT_SITE_TYPES, parseSiteTypes } from "@/lib/site-types";

/**
 * O que o site vende (Definições → Tipo de site): carros, motas ou os dois.
 * Sem nada guardado (ou sem acesso), carros e motas.
 */
const fetchSiteTypes = cachedPublic(async () => {
  const { data, error } = await supabasePublic
    .from("site_content")
    .select("content")
    .eq("key", "site")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseSiteTypes(data?.content ?? null);
}, "site-types");

export async function getSiteVehicleTypes(): Promise<VehicleType[]> {
  return safely("getSiteVehicleTypes", fetchSiteTypes, [...DEFAULT_SITE_TYPES]);
}
