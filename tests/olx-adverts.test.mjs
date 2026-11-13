// Anúncios da conta do OLX geridos no backoffice: os que o site criou, os
// feitos à mão no OLX e os exportados do Standvirtual (que o OLX não deixa
// alterar). Os dados de exemplo são os da conta do stand a 13/11/2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoader } from './support/load-ts.mjs';

const load = createLoader();
const A = load('src/lib/olx/adverts.ts');

const ADS = [
  { id: 675176856, title: 'Mercedes-Benz A 180 d Progressive Aut.', price: 21900, categoryName: 'Mercedes-Benz' },
  { id: 673875376, title: 'Renault Mégane 1.5 dCi GT Line', price: 11450, categoryName: 'Renault' },
  { id: 675176600, title: 'Renault Captur 0.9 TCE', price: 11500, categoryName: 'Renault' },
  { id: 675176520, title: 'BMW 420 d Auto', price: 22900, categoryName: 'BMW' },
  { id: 675176398, title: 'Citroën C3 1.2 PureTech C-Series', price: 12450, categoryName: 'Citroën' },
  { id: 672199203, title: 'BMW 116 d Pack M', price: 12900, categoryName: 'BMW' },
  { id: 673875380, title: 'BMW 525 d Auto', price: 14350, categoryName: 'BMW' },
  { id: 672202645, title: 'Citroën C3 1.2 PureTech Feel', price: 11950, categoryName: 'Citroën' },
  { id: 672202637, title: 'Opel Combo 1.5 CDTi Edition', price: 12950, categoryName: 'Opel' },
  { id: 670778144, title: 'Mercedes-Benz CLA 180', price: 15900, categoryName: 'Mercedes-Benz' },
  { id: 667023834, title: 'Renault Grand Scenic', price: 6000, categoryName: 'Renault' },
];
const CARS = [
  ['bmw525', 'BMW', '525 d Auto', 14350], ['bmw420', 'BMW', '420 d', 22900], ['bmw116', 'BMW', '116d', 12900],
  ['c3', 'Citroën', 'C3', 12450], ['punto', 'Fiat', 'Punto', 4950], ['a180', 'Mercedes-Benz', 'A 180 d', 21900],
  ['p2008', 'Peugeot', '2008', 12950], ['captur', 'Renault', 'Captur', 11500], ['megane', 'Renault', 'Mégane', 11450],
].map(([id, make, model, price]) => ({ id, make, model, price }));

test('sugere as 7 viaturas certas, todas fortes, e nenhuma errada', () => {
  const s = A.suggestAll(ADS, CARS);
  assert.deepEqual(Object.fromEntries([...s].map(([k, v]) => [k, v.carId])), {
    675176856: 'a180', 673875376: 'megane', 675176600: 'captur', 675176520: 'bmw420',
    675176398: 'c3', 672199203: 'bmw116', 673875380: 'bmw525',
  });
  assert.ok([...s.values()].every((v) => v.strong));
});

test('dois anúncios para a mesma viatura: só o de preço igual', () => {
  const s = A.suggestAll(ADS, CARS);
  assert.equal(s.get(675176398)?.carId, 'c3');
  assert.equal(s.has(672202645), false);
});

test('marca e modelo sem o preço: sugestão fraca', () => {
  assert.deepEqual(
    A.suggestCar({ id: 1, title: 'BMW 116 d Pack M', price: 11000, categoryName: 'BMW' }, CARS),
    { carId: 'bmw116', strong: false },
  );
});

test('a marca tem de bater: o mesmo modelo de outra marca não serve', () => {
  assert.equal(A.suggestCar({ id: 2, title: 'Seat 2008 qualquer', price: 12950, categoryName: 'Seat' }, CARS), null);
});

test('a origem vem do external_id', () => {
  const ids = new Set(['11111111-1111-4111-8111-111111111111']);
  assert.equal(A.advertOrigin(null, ids), 'olx');
  assert.equal(A.advertOrigin('', ids), 'olx');
  assert.equal(A.advertOrigin('11111111-1111-4111-8111-111111111111', ids), 'site');
  assert.equal(A.advertOrigin('8097748498', ids), 'standvirtual');
  assert.equal(A.isStandvirtualExport('user: Anúncio exportado do  Standvirtual. Para alterá-lo, necessita de aceder à sua conta.'), true);
  assert.equal(A.isStandvirtualExport('Advert not found'), false);
  assert.equal(A.isStandvirtualExport(null), false);
});
