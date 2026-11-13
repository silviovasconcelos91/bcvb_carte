import { existsSync } from 'node:fs';
import { nextNumbers, photoPaths, sameName } from './lib.mjs';
import { processPhoto } from './photo.mjs';

const BUCKET = 'card-images';
const UPLOAD = { contentType: 'image/jpeg', upsert: false, cacheControl: '604800' }; // 7 jours de cache, comme la console

function ok({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// Photo prête à envoyer, ou la raison pour laquelle il n'y en a pas
async function readPhoto(path) {
  if (!path) return { reason: 'aucune photo fournie' };
  if (!existsSync(path)) return { reason: 'fichier introuvable' };
  try { return { photo: await processPhoto(path) }; } catch (e) { return { reason: `image illisible (${e.message})` }; }
}

// Importe un manifeste validé (parseManifest) : série, photos, cartes en préparation
export async function importSeries(manifest, sb, { dryRun = false, now = Date.now } = {}) {
  const rarity = ok(await sb.from('rarities').select('id').eq('code', manifest.rarity).maybeSingle());
  if (!rarity) throw new Error(`Rareté inconnue : « ${manifest.rarity} »`);

  const report = { set: { id: null, name: manifest.set, created: false }, created: [], skipped: [], noPhoto: [], failed: [] };

  const set = ok(await sb.from('card_sets').select('id').eq('name', manifest.set).maybeSingle());
  let existing = [];
  if (set) {
    report.set.id = set.id;
    existing = ok(await sb.from('cards').select('name, number').eq('set_id', set.id));
  } else {
    report.set.created = true;
    if (!dryRun) report.set.id = ok(await sb.from('card_sets').insert({ name: manifest.set, in_boosters: false }).select('id').single()).id;
  }

  const todo = manifest.cards.filter(c => {
    const dup = existing.some(e => sameName(e.name, c.name));
    if (dup) report.skipped.push({ name: c.name, reason: 'déjà présente' });
    return !dup;
  });
  const numbers = nextNumbers(existing.map(e => e.number), todo.length);

  for (const [i, c] of todo.entries()) {
    const number = numbers[i];
    const { photo, reason } = await readPhoto(c.photo);
    if (!photo) report.noPhoto.push({ name: c.name, reason });
    if (dryRun) { report.created.push({ name: c.name, number }); continue; }

    const uploaded = [];
    try {
      let paths = { image_path: null, thumb_path: null };
      if (photo) {
        paths = photoPaths(report.set.id, c.name, now());
        for (const [path, body] of [[paths.image_path, photo.full], [paths.thumb_path, photo.thumb]]) {
          ok(await sb.storage.from(BUCKET).upload(path, body, UPLOAD));
          uploaded.push(path);
        }
      }
      ok(await sb.from('cards').insert({
        set_id: report.set.id, number, name: c.name, subtitle: c.subtitle, description: c.description,
        rarity_id: rarity.id, stats: c.numero != null ? { numero: c.numero } : {},
        ...paths, is_released: false, in_boosters: true,
      }));
      report.created.push({ name: c.name, number });
    } catch (e) {
      if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded);
      report.failed.push({ name: c.name, error: e.message });
    }
  }
  return report;
}
