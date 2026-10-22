import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const { outputText } = ts.transpileModule(readFileSync('src/lib/view-filter.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const mod = { exports: {} };
new Function('module', 'exports', outputText)(mod, mod.exports);
const { viewSkipReason, isBot } = mod.exports;

const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const real = { userAgent: chrome, host: 'supermotas.com', nodeEnv: 'production', cookieNames: ['coremotors_public_type'] };

test('a real visitor on the live site is counted', () => {
  assert.equal(viewSkipReason(real), null);
  assert.equal(viewSkipReason({ ...real, host: 'www.supermotas.com' }), null);
  assert.equal(viewSkipReason({ ...real, host: 'supermotas.netlify.app' }), null);
});

test('local development and Netlify previews are not counted', () => {
  assert.equal(viewSkipReason({ ...real, nodeEnv: 'development' }), 'dev');
  assert.equal(viewSkipReason({ ...real, host: 'localhost:3000' }), 'dev');
  assert.equal(viewSkipReason({ ...real, host: 'deploy-preview-12--supermotas.netlify.app' }), 'preview');
});

test('robots and link previews are not counted', () => {
  for (const ua of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0 Safari/537.36',
    'facebookexternalhit/1.1',
    'WhatsApp/2.23.20.0',
    'Chrome-Lighthouse',
    '',
  ]) assert.equal(viewSkipReason({ ...real, userAgent: ua }), 'bot', ua);
  assert.equal(isBot(chrome), false);
});

test('the team (logged into the backoffice) is not counted', () => {
  assert.equal(viewSkipReason({ ...real, cookieNames: ['sb-hmmuhxfggwhvvvtzbdps-auth-token'] }), 'staff');
  assert.equal(viewSkipReason({ ...real, cookieNames: ['sb-hmmuhxfggwhvvvtzbdps-auth-token.0', 'sb-hmmuhxfggwhvvvtzbdps-auth-token.1'] }), 'staff');
});
