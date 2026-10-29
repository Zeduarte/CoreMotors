import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// SEO, JSON-LD, sitemap, feeds, ordenação, acessibilidade, cookies, chat e
// avaliações do Google — o site público visto pelos motores de busca.

const require = createRequire(import.meta.url);
process.env.NEXT_PUBLIC_SITE_URL = 'https://stand.example';

const cache = new Map();
/** Carrega um módulo TS/TSX do projeto; `stubs` substitui dependências. */
function load(file, stubs = {}) {
  file = resolve(file);
  const key = file + JSON.stringify(Object.keys(stubs));
  if (cache.has(key)) return cache.get(key);
  const mod = { exports: {} };
  cache.set(key, mod.exports);
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const custom = (id) => {
    if (id in stubs) return stubs[id];
    if (id === 'server-only') return {};
    if (id.startsWith('@/') || id.startsWith('.')) {
      let path = id.startsWith('@/') ? resolve('src', id.slice(2)) : resolve(dirname(file), id);
      if (!existsSync(path) || !/\.[jt]sx?$/.test(path)) path = existsSync(path + '.tsx') ? path + '.tsx' : path + '.ts';
      return load(path, stubs);
    }
    return require(id);
  };
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, custom);
  cache.set(key, mod.exports);
  return mod.exports;
}

const ldOf = (html) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);

const baseVehicle = {
  slug: 'bmw-320d-2019', make: 'BMW', model: '320d', year: 2019, price: 25000, mileage: 90000,
  fuel: 'Diesel', transmission: 'Automática', body: 'Berlina', power: 190, displacement: 1995,
  color: 'Preto', doors: 4, seats: 5, featured: false, tagline: '', description: 'Muito estimado.',
  images: [{ src: '/placeholder-car.svg', alt: 'x', width: 1, height: 1 }], highlights: [],
  vehicleType: 'car', status: 'published',
};

test('vehicle JSON-LD reflects sold/reserved availability and omits price on request', () => {
  const { buildVehicleJsonLd } = load('src/components/seo/VehicleJsonLd.tsx');
  const car = buildVehicleJsonLd(baseVehicle, 'Stand');
  assert.equal(car['@type'], 'Car');
  assert.equal(car.offers.availability, 'https://schema.org/InStock');
  assert.equal(car.offers.price, 25000);
  assert.equal(car.numberOfDoors, 4);
  assert.equal(car.image[0], 'https://stand.example/placeholder-car.svg');
  assert.equal(car.url, 'https://stand.example/viaturas/bmw-320d-2019');

  assert.equal(buildVehicleJsonLd({ ...baseVehicle, status: 'sold' }).offers.availability, 'https://schema.org/SoldOut');
  assert.equal(buildVehicleJsonLd({ ...baseVehicle, status: 'reserved' }).offers.availability, 'https://schema.org/Reserved');

  const onRequest = buildVehicleJsonLd({ ...baseVehicle, price: 0, priceOnRequest: true });
  assert.ok(!('price' in onRequest.offers));
  assert.ok(!('priceCurrency' in onRequest.offers));
});

test('motorcycle JSON-LD uses schema.org Motorcycle and drops zero/unknown fields', () => {
  const { buildVehicleJsonLd, VehicleJsonLd } = load('src/components/seo/VehicleJsonLd.tsx');
  const moto = { ...baseVehicle, vehicleType: 'motorcycle', body: 'Naked', doors: 0, seats: 0, power: 0, displacement: 0, description: '  ', color: '' };
  const ld = buildVehicleJsonLd(moto);
  assert.equal(ld['@type'], 'Motorcycle');
  for (const k of ['numberOfDoors', 'vehicleSeatingCapacity', 'vehicleEngine', 'description', 'color']) assert.ok(!(k in ld), k);
  assert.equal(buildVehicleJsonLd({ ...moto, body: 'Moto 4' })['@type'], 'Vehicle');
  // Uma mota com portas na BD (dado errado) continua sem `numberOfDoors`.
  assert.ok(!('numberOfDoors' in buildVehicleJsonLd({ ...moto, doors: 2 })));
  // O componente serializa o mesmo objeto, escapado.
  const html = renderToStaticMarkup(React.createElement(VehicleJsonLd, { vehicle: { ...moto, description: '</script>' } }));
  assert.equal(ldOf(html).description, '</script>');
});

test('opening hours keep the afternoon range and minutes ("9h00-12h30 das 14h00-19h00")', () => {
  const { parseOpeningHours } = load('src/lib/opening-hours.ts');
  const week = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // O formato do site em produção.
  assert.deepEqual(parseOpeningHours('Seg-Sáb  9h00-12h30 das 14h00-19h00'), [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: week, opens: '09:00', closes: '12:30' },
    { '@type': 'OpeningHoursSpecification', dayOfWeek: week, opens: '14:00', closes: '19:00' },
  ]);
  assert.equal(parseOpeningHours('Seg–Sáb · 09h00–12h30 · 14h00–19h00').length, 2);
  assert.deepEqual(parseOpeningHours('Seg–Sex 9:30-19:00 · Sáb 10h–13h · Dom encerrado').map((s) => [s.dayOfWeek.length, s.opens, s.closes]), [
    [5, '09:30', '19:00'],
    [1, '10:00', '13:00'],
  ]);
  assert.deepEqual(parseOpeningHours('Segunda a sexta, das 9h às 19h')[0].dayOfWeek, week.slice(0, 5));
  // Sem dias não se inventa nada.
  assert.equal(parseOpeningHours('9:30-19:00'), null);
  assert.equal(parseOpeningHours(''), null);
  assert.equal(parseOpeningHours('Internacional 10-12'), null);
});

test('dealer JSON-LD publishes openingHoursSpecification and no fixed priceRange', () => {
  const { DealerJsonLd } = load('src/components/seo/DealerJsonLd.tsx');
  const { DEFAULT_BRANDING } = load('src/lib/branding.ts');
  const branding = { ...DEFAULT_BRANDING, company: { ...DEFAULT_BRANDING.company, hours: 'Seg-Sáb  9h00-12h30 das 14h00-19h00' } };
  const ld = ldOf(renderToStaticMarkup(React.createElement(DealerJsonLd, { branding })));
  assert.ok(!('priceRange' in ld));
  assert.ok(!('openingHours' in ld));
  assert.deepEqual(ld.openingHoursSpecification.map((s) => `${s.opens}-${s.closes}`), ['09:00-12:30', '14:00-19:00']);
});
