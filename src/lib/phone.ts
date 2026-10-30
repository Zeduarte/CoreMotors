/**
 * Normalização de números de telefone. Vive num módulo próprio porque é
 * precisa em `site.ts` (defaults) e em `branding.ts` (dados do backoffice), e
 * `branding.ts` já importa `site.ts` — não pode haver ciclo.
 */

/**
 * Normaliza um número de WhatsApp para o formato que o `wa.me` exige:
 * indicativo do país seguido do número, só dígitos.
 *
 * Um número nacional de 9 dígitos gravado sem indicativo (ex.: "916193337")
 * gerava um link que o WhatsApp não reconhece. Aqui assume-se Portugal (351)
 * para os 9 dígitos que começam por 2 ou 9, que é o plano de numeração
 * português; tudo o resto fica como está, incluindo números já internacionais.
 */
export function normalizeWhatsApp(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (/^[29]\d{8}$/.test(digits)) return `351${digits}`;
  return digits;
}

/**
 * Telefone escrito por um cliente nos formulários públicos, sem separadores:
 * "912-345-678", "912.345.678", "+351 912 345 678" e "(+351) 912345678"
 * ficam "912345678" / "+351912345678". Só fica o "+" inicial e os dígitos.
 */
export function compactPhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  return /^\(?\+/.test(trimmed) ? `+${digits}` : digits;
}

/**
 * Telefone aceitável (o mesmo critério no browser e no servidor): 9 a 15
 * dígitos, com espaços, hífenes, pontos ou parênteses pelo meio e um "+" no
 * início. Antes, só dígitos, espaços e "+" — "912-345-678" era recusado.
 */
export function isValidPhone(raw: string): boolean {
  if (!/^[\d\s+().-]+$/.test(raw.trim())) return false;
  return /^\+?\d{9,15}$/.test(compactPhone(raw));
}
