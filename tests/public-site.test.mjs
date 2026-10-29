import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Site público: cache da CDN, rotas, mundo carros/motas e formulários.

/** Cabeçalhos que o next.config.mjs aplica a um endereço (por `source`). */
async function configHeaders(source) {
  const { default: config } = await import(`../next.config.mjs?t=${Date.now()}`);
  const rules = await config.headers();
  const rule = rules.find((r) => r.source === source);
  return Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));
}
const directives = (value) => (value ?? "").split(",").map((d) => d.trim());

test("the CDN keeps one copy per search on the stock and compare pages", async () => {
  // `query` sem lista: o Netlify varia por toda a pesquisa (e o runtime do Next
  // no Netlify junta-o aos seus `query=__nextDataReq|_rsc` como `query`).
  for (const page of ["/inventario", "/comparar"]) {
    const h = await configHeaders(page);
    assert.match(h["Netlify-CDN-Cache-Control"], /s-maxage=60/, page);
    assert.ok(directives(h["Netlify-Vary"]).includes("query"), page);
    assert.ok(directives(h["Netlify-Vary"]).includes("cookie=coremotors_public_type"), page);
  }
  // As outras páginas não dependem da pesquisa: ?utm_… não parte a cache.
  for (const page of ["/", "/carros/:path*", "/viaturas/:path*", "/sobre"]) {
    const h = await configHeaders(page);
    assert.match(h["Netlify-CDN-Cache-Control"], /s-maxage=60/, page);
    assert.ok(!directives(h["Netlify-Vary"]).some((d) => d.startsWith("query")), page);
  }
});
