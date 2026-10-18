import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const { outputText } = ts.transpileModule(readFileSync('src/lib/json-ld.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const mod = { exports: {} };
new Function('module', 'exports', outputText)(mod, mod.exports);
const { safeJsonLd } = mod.exports;

test('safeJsonLd never emits a raw </script> or <!--', () => {
  const data = { description: 'x</script><script>alert(1)</script><!-- y' };
  const out = safeJsonLd(data);
  assert.ok(!out.includes('</script'));
  assert.ok(!out.includes('<'));
  assert.ok(!out.includes('<!--'));
  assert.deepEqual(JSON.parse(out), data);
});

test('safeJsonLd escapes >, & and U+2028/2029 and round-trips', () => {
  const data = { a: 'A&B > C D E', n: [1, { b: '<b>' }] };
  const out = safeJsonLd(data);
  for (const ch of ['>', '&', ' ', ' ']) assert.ok(!out.includes(ch));
  assert.deepEqual(JSON.parse(out), data);
});
