import { z } from "zod";
import { canonicalBrand } from "./brand-name";
import type { AlertCriteria } from "./stock-alerts";

/**
 * Validação dos critérios de um alerta de stock. À parte de `stock-alerts.ts`
 * para o formulário do site não levar o zod para o browser: valida-se no
 * servidor, ao gravar e ao comparar.
 */

const optionalNumber = (max: number) =>
  z.preprocess(
    (v) => (v === "" || v == null ? null : typeof v === "string" ? v.replace(/[^\d]/g, "") || null : v),
    z.coerce.number().int().min(0).max(max).nullable(),
  );
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() || null : v ?? null),
    z.string().max(max).nullable(),
  );

export const alertCriteriaSchema = z
  .object({
    vehicle_type: z.enum(["car", "motorcycle"]),
    make: optionalText(60).transform((m) => (m ? canonicalBrand(m) : null)),
    model: optionalText(80),
    body: optionalText(40),
    fuel: optionalText(40),
    max_price: optionalNumber(9_999_999),
    min_year: optionalNumber(2100),
    max_km: optionalNumber(9_999_999),
  })
  // Sem marca, categoria nem preço, o alerta dispararia com todas as viaturas.
  .refine((c) => Boolean(c.make || c.body || c.max_price), {
    message: "Indique pelo menos a marca, a categoria ou o preço máximo.",
    path: ["make"],
  });

/** Critérios guardados num contacto (ou `null` se for um alerta antigo, só com texto). */
export function parseCriteria(raw: unknown): AlertCriteria | null {
  const parsed = alertCriteriaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

