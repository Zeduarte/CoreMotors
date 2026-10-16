/**
 * Visitas ao stand — regras PURAS (horário, vagas, textos).
 *
 * O horário é o do stand, em Lisboa, seja qual for o fuso de quem marca ou do
 * servidor. Cada vaga é identificada pelo instante em UTC (ISO), que é o que
 * fica gravado em `leads.visit_at`.
 */

export const VISIT_TZ = "Europe/Lisbon";

export interface VisitSchedule {
  /** Por dia da semana (0 = domingo): intervalos ["09:00", "19:00"]. */
  days: Record<string, [string, string][]>;
  /** Duração de cada vaga, em minutos. */
  slot: number;
  /** Visitas em simultâneo na mesma vaga. */
  capacity: number;
  /** Antecedência mínima, em horas. */
  notice_hours: number;
  /** Até quantos dias à frente se pode marcar. */
  max_days: number;
}

const WEEK: [string, string][] = [["09:00", "19:00"]];
export const DEFAULT_VISIT_SCHEDULE: VisitSchedule = {
  days: { "0": [], "1": WEEK, "2": WEEK, "3": WEEK, "4": WEEK, "5": WEEK, "6": WEEK },
  slot: 30,
  capacity: 1,
  notice_hours: 2,
  max_days: 21,
};

export const WEEKDAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clamp = (n: unknown, min: number, max: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;

/** O horário guardado, validado; o que faltar ou vier mal fica com o padrão. */
export function parseVisitSchedule(raw: unknown): VisitSchedule {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof VisitSchedule, unknown>>;
  const d = DEFAULT_VISIT_SCHEDULE;
  const days: VisitSchedule["days"] = {};
  const rawDays = (r.days && typeof r.days === "object" ? r.days : null) as Record<string, unknown> | null;
  for (let i = 0; i < 7; i++) {
    const list = rawDays?.[String(i)];
    days[String(i)] = Array.isArray(list)
      ? list
          .filter(
            (x): x is [string, string] =>
              Array.isArray(x) && TIME.test(String(x[0])) && TIME.test(String(x[1])) && toMinutes(x[0]) < toMinutes(x[1]),
          )
          .slice(0, 4)
      : rawDays
        ? []
        : d.days[String(i)]!;
  }
  return {
    days,
    slot: [15, 20, 30, 45, 60, 90, 120].includes(r.slot as number) ? (r.slot as number) : d.slot,
    capacity: clamp(r.capacity, 1, 20, d.capacity),
    notice_hours: clamp(r.notice_hours, 0, 72, d.notice_hours),
    max_days: clamp(r.max_days, 1, 90, d.max_days),
  };
}

/** Data, dia da semana e minutos do dia em Lisboa. */
export function zonedParts(date: Date, tz = VISIT_TZ) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday!);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    asUtc: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)),
  };
}

/** "2026-10-21" + "10:30" em Lisboa → o instante em UTC (com a hora de verão certa). */
export function zonedToUtc(date: string, time: string, tz = VISIT_TZ): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, Number(time.slice(0, 2)), Number(time.slice(3, 5)));
  const offset = (at: number) => zonedParts(new Date(at), tz).asUtc - Math.floor(at / 1000) * 1000;
  let at = guess - offset(guess);
  // Na mudança de hora o primeiro palpite pode cair do outro lado.
  at = guess - offset(at);
  return new Date(at);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface VisitSlot {
  /** O instante em UTC (ISO) — o valor gravado. */
  at: string;
  /** "10:30", em Lisboa. */
  time: string;
  available: boolean;
}
export interface VisitDay {
  date: string;
  weekday: number;
  slots: VisitSlot[];
}

/** Chave de uma vaga, para contar as ocupadas (a base de dados devolve "+00:00"). */
export function slotKey(at: string | Date): string {
  return new Date(at).toISOString();
}

/**
 * Os dias com horário de abertura, de hoje até `max_days`, com as vagas de
 * cada um. Uma vaga está livre se ainda faltar a antecedência mínima e não
 * estiver cheia.
 */
export function visitDays(schedule: VisitSchedule, now: Date, taken: Record<string, number> = {}): VisitDay[] {
  const today = zonedParts(now).date;
  const earliest = now.getTime() + schedule.notice_hours * 3_600_000;
  const out: VisitDay[] = [];
  for (let i = 0; i <= schedule.max_days; i++) {
    const date = addDays(today, i);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const slots: VisitSlot[] = [];
    for (const [from, to] of schedule.days[String(weekday)] ?? []) {
      for (let t = toMinutes(from); t + schedule.slot <= toMinutes(to); t += schedule.slot) {
        const time = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
        const at = zonedToUtc(date, time);
        if (at.getTime() < earliest) continue;
        const key = at.toISOString();
        slots.push({ at: key, time, available: (taken[key] ?? 0) < schedule.capacity });
      }
    }
    if (slots.length) out.push({ date, weekday, slots });
  }
  return out;
}

/** A vaga existe no horário e está livre? (a validação do servidor) */
export function isBookable(schedule: VisitSchedule, now: Date, at: string, taken: Record<string, number> = {}): boolean {
  const key = slotKey(at);
  return visitDays(schedule, now, taken).some((d) => d.slots.some((s) => s.at === key && s.available));
}

/** "terça-feira, 21 de outubro, às 10:30" (em Lisboa). */
export function visitWhenLabel(at: string | Date): string {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat("pt-PT", {
    timeZone: VISIT_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  const time = new Intl.DateTimeFormat("pt-PT", { timeZone: VISIT_TZ, hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day}, às ${time}`;
}

/** "21/10 · 10:30" — curto, para listas e para o botão de enviar (cabe no telemóvel). */
export function visitShortLabel(at: string | Date): string {
  const d = new Date(at);
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: VISIT_TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(",", " ·");
}

/** Texto de confirmação para o botão «Enviar pelo WhatsApp» da equipa. */
export function visitMessage(input: { name: string; company: string; at: string; car: string | null; address: string }): string {
  const first = input.name.trim().split(/\s+/)[0] || "";
  return (
    `Olá${first ? ` ${first}` : ""}! A sua visita à ${input.company} está marcada para ${visitWhenLabel(input.at)}.` +
    (input.car ? `\n\nViatura: ${input.car}` : "") +
    (input.address ? `\nMorada: ${input.address}` : "") +
    `\n\nSe precisar de mudar a hora, responda a esta mensagem.`
  );
}

/** Ficheiro .ics para «Adicionar ao calendário». */
export function visitIcs(input: { at: string; minutes: number; title: string; location: string; description: string; uid: string }): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
  const start = new Date(input.at);
  const end = new Date(start.getTime() + input.minutes * 60_000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//engineline//visitas//PT",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(input.title)}`,
    `LOCATION:${esc(input.location)}`,
    `DESCRIPTION:${esc(input.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
