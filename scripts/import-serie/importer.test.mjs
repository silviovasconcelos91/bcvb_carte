import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { importSeries } from './importer.mjs';

// Faux client Supabase en mémoire : juste ce que l'import utilise
function fakeSupabase(tables, { failInsertFor } = {}) {
  const calls = { insert: [], upload: [], remove: [] };
  let nextId = 100;
  const from = table => {
    const filters = [];
    let pending = null;
    const rows = () => (tables[table] ??= []).filter(r => filters.every(([k, v]) => r[k] === v));
    const result = () => {
      if (pending) {
        if (failInsertFor && pending.name === failInsertFor) return { data: null, error: { message: 'insert refusé' } };
        const row = { id: nextId++, ...pending };
        tables[table].push(row);
        calls.insert.push({ table, row: pending });
        return { data: [row], error: null };
      }
      return { data: rows(), error: null };
    };
    const q = {
      select: () => q,
      eq: (k, v) => { filters.push([k, v]); return q; },
      insert: row => { tables[table] ??= []; pending = row; return q; },
      maybeSingle: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; },
      single: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (ok, ko) => Promise.resolve(result()).then(ok, ko),
    };
    return q;
  };
  const storage = {
    from: bucket => ({
      upload: async (path, body, opts) => { calls.upload.push({ bucket, path, opts }); return { data: { path }, error: null }; },
      remove: async paths => { calls.remove.push({ bucket, paths }); return { data: [], error: null }; },
    }),
  };
  return { sb: { from, storage }, calls, tables };
}

const rarities = () => [{ id: 1, code: 'common' }, { id: 2, code: 'uncommon' }];
let photo;
before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-serie-'));
  photo = join(dir, 'joueur.png');
  writeFileSync(photo, await sharp({ create: { width: 400, height: 600, channels: 3, background: '#2244aa' } }).png().toBuffer());
});

const card = (name, extra = {}) => ({ name, subtitle: null, description: null, numero: null, photo: null, ...extra });

test('série inconnue : créée hors boosters, cartes numérotées et en préparation', async () => {
  const f = fakeSupabase({ rarities: rarities(), card_sets: [], cards: [] });
  const report = await importSeries(
    { set: 'EDF', rarity: 'common', cards: [card('Earvin Ngapeth', { numero: 9, photo, subtitle: 'Réceptionneur-attaquant' }), card('Jenia Grebennikov')] },
    f.sb,
  );
  assert.equal(report.set.created, true);
  const set = f.calls.insert.find(c => c.table === 'card_sets');
  assert.deepEqual(set.row, { name: 'EDF', in_boosters: false });
  const cards = f.calls.insert.filter(c => c.table === 'cards').map(c => c.row);
  assert.deepEqual(cards.map(c => c.number), [1, 2]);
  assert.ok(cards.every(c => c.is_released === false && c.in_boosters === true && c.rarity_id === 1));
  assert.deepEqual(cards[0].stats, { numero: 9 });
  assert.deepEqual(cards[1].stats, {});
  assert.equal(f.calls.upload.length, 2);
  for (const u of f.calls.upload) {
    assert.equal(u.bucket, 'card-images');
    assert.deepEqual(u.opts, { contentType: 'image/jpeg', upsert: false, cacheControl: '604800' });
  }
  assert.deepEqual(report.created.map(c => c.number), [1, 2]);
});

test('série existante : doublon ignoré, numérotation à la suite', async () => {
  const f = fakeSupabase({
    rarities: rarities(),
    card_sets: [{ id: 7, name: 'EDF' }],
    cards: [{ id: 1, set_id: 7, name: 'Earvin Ngapeth', number: 4 }],
  });
  const report = await importSeries({ set: 'EDF', rarity: 'common', cards: [card('earvin ngapeth'), card('Trévor Clévenot')] }, f.sb);
  assert.equal(report.set.created, false);
  assert.deepEqual(report.skipped, [{ name: 'earvin ngapeth', reason: 'déjà présente' }]);
  assert.deepEqual(report.created, [{ name: 'Trévor Clévenot', number: 5 }]);
  assert.ok(!f.calls.insert.some(c => c.table === 'card_sets'));
});

test('photo introuvable : carte créée sans image et signalée', async () => {
  const f = fakeSupabase({ rarities: rarities(), card_sets: [], cards: [] });
  const report = await importSeries({ set: 'EDF', rarity: 'common', cards: [card('Antoine Brizard', { photo: 'C:/inexistant.jpg' })] }, f.sb);
  const row = f.calls.insert.find(c => c.table === 'cards').row;
  assert.equal(row.image_path, null);
  assert.equal(row.thumb_path, null);
  assert.deepEqual(report.noPhoto, ['Antoine Brizard']);
  assert.equal(f.calls.upload.length, 0);
});

test('insertion refusée : photos supprimées, carte suivante créée', async () => {
  const f = fakeSupabase({ rarities: rarities(), card_sets: [], cards: [] }, { failInsertFor: 'Nicolas Le Goff' });
  const report = await importSeries({ set: 'EDF', rarity: 'common', cards: [card('Nicolas Le Goff', { photo }), card('Barthélémy Chinenyeze')] }, f.sb);
  const uploaded = f.calls.upload.map(u => u.path);
  assert.equal(f.calls.remove.length, 1);
  assert.deepEqual(f.calls.remove[0].paths.sort(), uploaded.sort());
  assert.equal(report.failed.length, 1);
  assert.equal(report.failed[0].name, 'Nicolas Le Goff');
  assert.deepEqual(report.created.map(c => c.name), ['Barthélémy Chinenyeze']);
});

test('dry-run : rien n’est écrit', async () => {
  const f = fakeSupabase({ rarities: rarities(), card_sets: [], cards: [] });
  const report = await importSeries({ set: 'EDF', rarity: 'common', cards: [card('Earvin Ngapeth', { photo })] }, f.sb, { dryRun: true });
  assert.equal(f.calls.insert.length, 0);
  assert.equal(f.calls.upload.length, 0);
  assert.equal(report.set.id, null);
  assert.deepEqual(report.created, [{ name: 'Earvin Ngapeth', number: 1 }]);
});

test('rareté inconnue : refus explicite', async () => {
  const f = fakeSupabase({ rarities: rarities(), card_sets: [], cards: [] });
  await assert.rejects(importSeries({ set: 'EDF', rarity: 'inconnue', cards: [card('A')] }, f.sb), /inconnue/);
});
