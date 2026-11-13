// Importe une série de cartes décrite dans un manifeste JSON (voir .claude/skills/generer-serie)
// Usage : node scripts/import-serie.mjs <manifeste.json> [--dry-run]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parseManifest } from './import-serie/lib.mjs';
import { importSeries } from './import-serie/importer.mjs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = args.find(a => !a.startsWith('--'));
if (!file) fail('Usage : node scripts/import-serie.mjs <manifeste.json> [--dry-run]');

const envFile = resolve(import.meta.dirname, '..', '.env.local'); // .env.local du projet, d'où qu'on lance la commande
try { process.loadEnvFile(envFile); } catch { fail(`Fichier introuvable : ${envFile}`); }
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) fail('VITE_SUPABASE_URL manque dans .env.local.');
if (!key) fail('SUPABASE_SERVICE_ROLE_KEY manque dans .env.local.\nTu la trouves dans Supabase : Project Settings > API Keys > clé secrète (service_role). Ne la préfixe jamais par VITE_.');

let manifest;
try {
  manifest = parseManifest(JSON.parse(readFileSync(file, 'utf8')));
} catch (e) {
  fail(e instanceof SyntaxError ? `JSON illisible : ${e.message}` : e.message);
}
// Les chemins des photos sont relatifs au dossier du manifeste
const base = dirname(resolve(file));
for (const c of manifest.cards) if (c.photo) c.photo = resolve(base, c.photo);

const sb = createClient(url, key, { auth: { persistSession: false } });
let report;
try {
  report = await importSeries(manifest, sb, { dryRun });
} catch (e) {
  fail(`Import interrompu : ${e.message}`);
}

const r = report;
console.log(dryRun ? '\n— Simulation (rien n’a été écrit) —' : '');
console.log(`Série « ${r.set.name} » : ${r.set.created ? (dryRun ? 'serait créée' : `créée (id ${r.set.id}), hors boosters`) : `réutilisée (id ${r.set.id})`}`);
console.log(`\n${dryRun ? 'Cartes à créer' : 'Cartes créées'} : ${r.created.length}`);
for (const c of r.created) console.log(`  n°${c.number}  ${c.name}`);
if (r.skipped.length) { console.log(`\nIgnorées : ${r.skipped.length}`); for (const c of r.skipped) console.log(`  ${c.name} (${c.reason})`); }
if (r.noPhoto.length) { console.log(`\nSans photo : ${r.noPhoto.length}`); for (const c of r.noPhoto) console.log(`  ${c.name} : ${c.reason}`); }
if (r.failed.length) { console.log(`\nÉchecs : ${r.failed.length}`); for (const c of r.failed) console.log(`  ${c.name} : ${c.error}`); }
if (!dryRun && r.created.length) console.log('\nCartes en préparation : publie-les depuis /admin > Cartes, puis active la série dans les boosters.');
process.exit(r.failed.length ? 1 : 0);
