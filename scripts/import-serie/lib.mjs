// Fonctions pures de l'import d'une série : noms, chemins, numéros, manifeste

const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Même règle que src/lib/format.ts, pour des chemins identiques à ceux de la console
export const slug = s =>
  stripAccents(String(s || 'carte')).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'carte';

const key = s => stripAccents(String(s)).trim().toLowerCase().replace(/\s+/g, ' ');
export const sameName = (a, b) => key(a) === key(b);

export function photoPaths(setId, name, now = Date.now()) {
  const base = `${setId}/${slug(name)}-${now.toString(36)}`;
  return { image_path: `${base}.jpg`, thumb_path: `${base}.thumb.jpg` };
}

export function nextNumbers(existing, count) {
  const max = Math.max(0, ...existing.filter(n => Number.isInteger(n)));
  return Array.from({ length: count }, (_, i) => max + 1 + i);
}

const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function parseManifest(raw) {
  const errors = [];
  const m = raw && typeof raw === 'object' ? raw : {};
  const set = text(m.set);
  if (!set) errors.push('« set » : nom de la série manquant');
  const rarity = text(m.rarity) ?? 'common';
  const list = Array.isArray(m.cards) ? m.cards : [];
  if (!list.length) errors.push('« cards » : il faut au moins une carte');

  const cards = list.map((c, i) => {
    const at = `carte #${i + 1}`;
    const name = text(c?.name);
    if (!name) errors.push(`${at} : « name » manquant`);
    let numero = c?.numero ?? null;
    if (numero !== null && !(Number.isInteger(numero) && numero >= 0 && numero <= 99)) {
      errors.push(`${at} : « numero » doit être un entier entre 0 et 99`);
      numero = null;
    }
    return { name: name ?? '', subtitle: text(c?.subtitle), description: text(c?.description), numero, photo: text(c?.photo) };
  });

  cards.forEach((c, i) => {
    if (c.name && cards.findIndex(o => sameName(o.name, c.name)) < i) errors.push(`carte #${i + 1} : « ${c.name} » en double`);
  });

  if (errors.length) throw new Error(`Manifeste invalide :\n- ${errors.join('\n- ')}`);
  return { set, rarity, cards };
}
