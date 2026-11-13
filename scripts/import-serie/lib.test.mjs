import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug, sameName, photoPaths, nextNumbers, parseManifest } from './lib.mjs';

test('slug : accents retirés, tirets, minuscules', () => {
  assert.equal(slug('Earvin Ngapeth'), 'earvin-ngapeth');
  assert.equal(slug('Jean-Patrick Ngapeth Ébé'), 'jean-patrick-ngapeth-ebe');
  assert.equal(slug(''), 'carte');
  assert.ok(slug('x'.repeat(80)).length <= 40);
});

test('sameName ignore casse, accents et espaces aux bords', () => {
  assert.equal(sameName('Barthélémy Chinenyeze', ' barthelemy chinenyeze '), true);
  assert.equal(sameName('Earvin Ngapeth', 'Swan Ngapeth'), false);
});

test('photoPaths suit le format de la console', () => {
  assert.deepEqual(photoPaths(3, 'Earvin Ngapeth', 0), {
    image_path: '3/earvin-ngapeth-0.jpg',
    thumb_path: '3/earvin-ngapeth-0.thumb.jpg',
  });
});

test('nextNumbers continue après le plus grand numéro', () => {
  assert.deepEqual(nextNumbers([1, 4, null], 3), [5, 6, 7]);
  assert.deepEqual(nextNumbers([], 2), [1, 2]);
});

test('parseManifest complète les valeurs par défaut', () => {
  const m = parseManifest({ set: 'EDF', cards: [{ name: 'Earvin Ngapeth' }] });
  assert.equal(m.rarity, 'common');
  assert.deepEqual(m.cards[0], { name: 'Earvin Ngapeth', subtitle: null, description: null, numero: null, photo: null });
});

test('parseManifest refuse un numéro hors 0–99', () => {
  assert.throws(() => parseManifest({ set: 'EDF', cards: [{ name: 'A', numero: 120 }] }), /numero/);
});

test('parseManifest refuse une liste vide', () => {
  assert.throws(() => parseManifest({ set: 'EDF', cards: [] }), /carte/);
});

test('parseManifest signale l’index de la carte sans nom', () => {
  assert.throws(() => parseManifest({ set: 'EDF', cards: [{ name: 'A' }, { subtitle: 'Libéro' }] }), /#2/);
});

test('parseManifest refuse deux cartes du même nom', () => {
  assert.throws(() => parseManifest({ set: 'EDF', cards: [{ name: 'Trévor Clévenot' }, { name: 'trevor clevenot' }] }), /double/);
});
