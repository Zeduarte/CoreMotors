import "server-only";
import { cache } from "react";
import { supabasePublic } from "@/lib/supabase/public";
import { cachedPublic, safely } from "@/lib/public-cache";
import { parseShowroom } from "./showroom";

const fetchShowroom = cachedPublic(async () => {
  const { data, error } = await supabasePublic
    .from("site_content")
    .select("content")
    .eq("key", "showroom")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseShowroom(data?.content);
}, "showroom");

/**
 * Pontos de venda, serviços, FAQ… Em cache como as outras leituras públicas, e
 * `cache` do React junta as várias chamadas do mesmo pedido numa só.
 */
export const getShowroomContent = cache(() =>
  safely("getShowroomContent", fetchShowroom, parseShowroom(null)),
);
