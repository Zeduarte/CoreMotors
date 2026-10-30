// Dashboard: os meses das vendas são os de Lisboa, mesmo com o servidor em UTC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const { outputText } = ts.transpileModule(readFileSync('src/lib/lisbon-months.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const mod = { exports: {} };
new Function('module', 'exports', outputText)(mod, mod.exports);
const { lisbonMonthWindows, lisbonMonthStart } = mod.exports;

await test('a month starts at midnight in Lisbon, summer and winter', () => {
  assert.equal(lisbonMonthStart(2026, 6).toISOString(), '2026-06-30T23:00:00.000Z', 'julho, hora de verão');
  assert.equal(lisbonMonthStart(2026, 11).toISOString(), '2026-12-01T00:00:00.000Z', 'dezembro, hora de inverno');
  assert.equal(lisbonMonthStart(2027, -1).toISOString(), '2026-12-01T00:00:00.000Z', 'mês anterior a janeiro');
});

await test('just after midnight on the 1st (Lisbon summer time) is already the new month', () => {
  // 1 de agosto às 00:30 em Lisboa = 31 de julho às 23:30 UTC.
  const now = new Date('2026-07-31T23:30:00Z');
  const w = lisbonMonthWindows(now, 6);
  assert.equal(w.length, 6);
  assert.equal(w.at(-1).month, 7, 'agosto');
  assert.equal(w.at(-1).start.toISOString(), '2026-07-31T23:00:00.000Z');
  assert.equal(w[0].month, 2, 'março');
  // Uma venda às 23:15 UTC de 31/07 (00:15 de 1/08 em Lisboa) conta em agosto.
  const sale = new Date('2026-07-31T23:15:00Z');
  assert.ok(sale >= w.at(-1).start && sale < w.at(-1).end);
  // Janelas seguidas, sem buracos.
  for (let i = 1; i < w.length; i++) assert.equal(w[i].start.getTime(), w[i - 1].end.getTime());
});

await test('across the year boundary', () => {
  const w = lisbonMonthWindows(new Date('2027-01-15T12:00:00Z'), 6);
  assert.deepEqual(w.map((x) => x.month), [7, 8, 9, 10, 11, 0]);
});
