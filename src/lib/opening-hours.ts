/**
 * Converte o horário escrito no backoffice em `openingHoursSpecification`
 * (schema.org), para o JSON-LD do stand. Função PURA.
 *
 * O horário é texto livre, por isso aceita as formas habituais:
 *   "Seg–Sáb · 09h00–19h00"
 *   "Seg-Sáb  9h00-12h30 das 14h00-19h00"          (pausa para almoço)
 *   "Seg–Sex 9:30-19:00 · Sáb 10h–13h · Dom encerrado"
 *   "Segunda a sexta, das 9h às 19h"
 *
 * Cada horário fica com os dias escritos antes dele. Dias sem horas (ex.:
 * "Dom encerrado") não entram; horas sem nenhum dia antes também não — sem os
 * dias, o Google ficaria com informação inventada. Sem nada reconhecível,
 * devolve `null` (e o JSON-LD sai sem horário, como antes).
 */

export interface OpeningHoursSpec {
  "@type": "OpeningHoursSpecification";
  dayOfWeek: string[];
  opens: string;
  closes: string;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const DAY_INDEX: Record<string, number> = { seg: 0, ter: 1, qua: 2, qui: 3, sex: 4, sab: 5, dom: 6 };

// "seg", "segunda", "segunda-feira", "sáb.", "sábado"…
const DAY = String.raw`(?<![a-zà-ú])(seg|ter|qua|qui|sex|s[áa]b|dom)[a-zà-ú]*(?:-feira)?\.?`;
// "9h", "9h30", "09h00", "9:30", "19.00", "19"
const TIME = String.raw`(?<!\d)(\d{1,2})(?:\s*[h:.]\s*(\d{2})?)?`;
const TO = String.raw`\s*(?:[–—-]|\s(?:a|à|às|até)\s)\s*`;
const TOKEN = new RegExp(
  String.raw`(?:${DAY}(?:${TO}${DAY})?)|(?:${TIME}${TO}${TIME})`,
  "giu",
);

function dayIndex(word: string): number {
  return DAY_INDEX[word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")] ?? -1;
}

function hhmm(h: string, m: string | undefined): string | null {
  const hour = Number(h);
  const min = Number(m ?? 0);
  if (!Number.isInteger(hour) || hour > 24 || min > 59) return null;
  if (hour === 24 && min > 0) return null;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseOpeningHours(text: string | null | undefined): OpeningHoursSpec[] | null {
  if (!text?.trim()) return null;
  const groups: { days: Set<number>; times: [string, string][] }[] = [];
  let current: (typeof groups)[number] | null = null;

  for (const m of text.normalize("NFC").matchAll(TOKEN)) {
    if (m[1]) {
      // Dias. Depois de um horário, os dias seguintes começam um grupo novo.
      if (!current || current.times.length) {
        current = { days: new Set(), times: [] };
        groups.push(current);
      }
      const from = dayIndex(m[1]);
      const to = m[2] ? dayIndex(m[2]) : from;
      if (from < 0 || to < 0) continue;
      // "Sáb–Seg" dá a volta à semana.
      for (let i = from; ; i = (i + 1) % 7) {
        current.days.add(i);
        if (i === to) break;
      }
    } else if (current) {
      const opens = hhmm(m[3]!, m[4]);
      const closes = hhmm(m[5]!, m[6]);
      if (opens && closes && opens < closes) current.times.push([opens, closes]);
    }
  }

  const specs = groups.flatMap((g) =>
    g.times.map(([opens, closes]) => ({
      "@type": "OpeningHoursSpecification" as const,
      dayOfWeek: [...g.days].sort((a, b) => a - b).map((d) => DAYS[d]!),
      opens,
      closes,
    })),
  );
  return specs.length ? specs : null;
}
