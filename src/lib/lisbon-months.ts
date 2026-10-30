/**
 * Meses do calendário de Lisboa, para os totais do Dashboard. O servidor do
 * Netlify corre em UTC: com `new Date(ano, mês, 1)` as vendas da primeira hora
 * do mês (horário de verão) contavam no mês anterior.
 */
const TZ = "Europe/Lisbon";

/** Diferença, em minutos, entre a hora de Lisboa e UTC nesse instante. */
function offsetMinutes(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return Math.round((local - at.getTime()) / 60_000);
}

/** Ano e mês (0–11) de um instante, em Lisboa. */
export function lisbonYearMonth(at: Date): { year: number; month: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric" })
      .formatToParts(at).map((x) => [x.type, x.value]),
  );
  return { year: +p.year!, month: +p.month! - 1 };
}

/** O instante em que começa o mês em Lisboa (o mês pode sair de 0–11). */
export function lisbonMonthStart(year: number, month: number): Date {
  const guess = Date.UTC(year, month, 1);
  // A mudança de hora nunca é à meia-noite do dia 1: o desvio desse instante serve.
  return new Date(guess - offsetMinutes(new Date(guess)) * 60_000);
}

/** Os últimos `count` meses (o atual incluído), do mais antigo para o mais recente. */
export function lisbonMonthWindows(now: Date, count: number): { start: Date; end: Date; month: number }[] {
  const { year, month } = lisbonYearMonth(now);
  return Array.from({ length: count }, (_, i) => {
    const m = month - (count - 1 - i);
    return {
      start: lisbonMonthStart(year, m),
      end: lisbonMonthStart(year, m + 1),
      month: ((m % 12) + 12) % 12,
    };
  });
}
