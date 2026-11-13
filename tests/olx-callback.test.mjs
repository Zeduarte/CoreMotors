// O Callback URL que tem de estar registado na aplicação do OLX Partner.
// Com o errado (ex.: http://localhost) o OLX devolve quem autoriza a esse
// endereço e a conta nunca fica ligada — por isso o painel mostra-o.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLoader } from './support/load-ts.mjs';

const load = createLoader({ sonner: { toast: { success() {}, error() {} } } });

test('o Callback URL é o endereço do site com /api/olx/callback', () => {
  const { olxCallbackUrl } = load('src/app/api/olx/redirect.ts');
  const antes = process.env.OLX_REDIRECT_URI;
  try {
    delete process.env.OLX_REDIRECT_URI;
    assert.equal(olxCallbackUrl('https://stand.pt'), 'https://stand.pt/api/olx/callback');
    assert.equal(olxCallbackUrl('https://stand.pt/'), 'https://stand.pt/api/olx/callback', 'sem barra dupla');
    // Com vários registados, o que vale é o que vai no pedido.
    process.env.OLX_REDIRECT_URI = ' https://outro.pt/api/olx/callback ';
    assert.equal(olxCallbackUrl('https://stand.pt'), 'https://outro.pt/api/olx/callback');
  } finally {
    if (antes === undefined) delete process.env.OLX_REDIRECT_URI;
    else process.env.OLX_REDIRECT_URI = antes;
  }
});

test('o painel mostra o Callback URL a registar no OLX, pronto a copiar', () => {
  const { OlxCallbackUrl } = load('src/components/admin/OlxCallbackUrl.tsx');
  const html = renderToStaticMarkup(React.createElement(OlxCallbackUrl, { url: 'https://stand.pt/api/olx/callback' }));
  assert.match(html, /https:\/\/stand\.pt\/api\/olx\/callback/);
  assert.match(html, /Callback URL/);
  assert.match(html, /<button[^>]*>Copiar<\/button>/);
});
