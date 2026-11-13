# Génération de série — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un skill Claude Code et un script Node qui importent une série de cartes (textes + photos) décrite dans un manifeste JSON vers Supabase.

**Architecture:** `scripts/import-serie/` contient trois modules ESM : `lib.mjs` (fonctions pures : validation, slug, chemins, numérotation), `photo.mjs` (recadrage `sharp`), `importer.mjs` (orchestration sur un client Supabase injecté) ; `scripts/import-serie.mjs` est le point d'entrée CLI. Le skill `.claude/skills/generer-serie/SKILL.md` décrit la recherche web, l'aperçu et l'appel du script.

**Tech Stack:** Node ≥ 20.19 (ESM, `node:test`, `process.loadEnvFile`), `@supabase/supabase-js` 2.116.0 (déjà présent), `sharp` (nouvelle devDependency).

**Spec:** `docs/superpowers/specs/2026-11-13-generation-serie-design.md`

## Global Constraints

- Clé lue dans `.env.local` : `SUPABASE_SERVICE_ROLE_KEY` (jamais préfixée `VITE_`), URL : `VITE_SUPABASE_URL`.
- Bucket : `card-images`. Chemins : `<set_id>/<slug>-<Date.now().toString(36)>.jpg` et `.thumb.jpg`.
- Envoi : `{ contentType: 'image/jpeg', upsert: false, cacheControl: '604800' }`.
- Photo 720×720, vignette 240×240 tirée du carré 720, JPEG qualité 85, fond blanc, `position: 'attention'`.
- Série créée avec `in_boosters = false` ; cartes insérées avec `is_released = false`, `in_boosters = true`.
- `stats` = `{ numero }` seulement (absent si pas de numéro). Rareté par défaut `common`.
- `slug` identique à `src/lib/format.ts:68` (accents retirés, minuscules, `[^a-z0-9]+` → `-`, 40 caractères max, `carte` par défaut).
- Textes affichés à l'utilisateur et commentaires en français, comme le reste du projet.

## Review Focus

- Relancer le même manifeste : aucune carte dupliquée (comparaison de nom insensible à la casse et aux accents), rapport « déjà présente ». → test Task 3.
- Photo manquante ou chemin inexistant : la carte est créée sans image, signalée ; le script ne s'arrête pas. → test Task 3.
- PNG avec transparence / WebP / photo paysage : sortie JPEG 720×720 sur fond blanc, pas de noir. → test Task 2.
- Échec d'insertion après envoi des photos : les fichiers envoyés pour cette carte sont supprimés du bucket. → test Task 3.
- `.env.local` sans `SUPABASE_SERVICE_ROLE_KEY` : message clair qui dit où trouver la clé, code de sortie 1, rien d'écrit. → Task 4 Step 3.

---

### Task 1: Fonctions pures et validation du manifeste

**Files:**
- Create: `scripts/import-serie/lib.mjs`
- Test: `scripts/import-serie/lib.test.mjs`
- Modify: `package.json` (script `"test:scripts": "node --test scripts/"`)

**Interfaces:**
- Produces:
  - `slug(s: string): string`
  - `sameName(a: string, b: string): boolean` — insensible casse/accents/espaces aux bords
  - `photoPaths(setId: number, name: string, now?: number): { image_path, thumb_path }`
  - `nextNumbers(existing: (number|null)[], count: number): number[]` — à la suite du max (1 si vide)
  - `parseManifest(raw: unknown): Manifest` — lève `Error` en français listant tous les problèmes
  - `Manifest = { set: string, rarity: string, cards: { name, subtitle: string|null, description: string|null, numero: number|null, photo: string|null }[] }`

- [ ] **Step 1: Write the failing tests** (`node:test` + `node:assert/strict`)
  - `slug('Earvin Ngapeth') === 'earvin-ngapeth'`, `slug('Jean-Patrick Ngapeth Ébé') === 'jean-patrick-ngapeth-ebe'`, `slug('') === 'carte'`, longueur ≤ 40.
  - `sameName('Barthélémy Chinenyeze', ' barthelemy chinenyeze ') === true`.
  - `photoPaths(3, 'Earvin Ngapeth', 0)` → `{ image_path: '3/earvin-ngapeth-0.jpg', thumb_path: '3/earvin-ngapeth-0.thumb.jpg' }`.
  - `nextNumbers([1, 4, null], 3)` → `[5, 6, 7]` ; `nextNumbers([], 2)` → `[1, 2]`.
  - `parseManifest` : `rarity` absente → `'common'` ; `subtitle`/`description`/`photo`/`numero` absents → `null` ; `numero: 120` → erreur ; `cards: []` → erreur ; carte sans `name` → erreur mentionnant l'index ; deux cartes de même nom (via `sameName`) → erreur.
- [ ] **Step 2:** `node --test scripts/` → FAIL (module introuvable).
- [ ] **Step 3:** Implémenter `lib.mjs` (numero : entier 0–99, comme `CardForm`).
- [ ] **Step 4:** `node --test scripts/` → PASS.
- [ ] **Step 5:** Commit `feat(generer-serie): manifeste et fonctions utilitaires`.

### Task 2: Recadrage des photos

**Files:**
- Create: `scripts/import-serie/photo.mjs`
- Test: `scripts/import-serie/photo.test.mjs`
- Modify: `package.json` (devDependency `sharp`, `npm install -D sharp`)

**Interfaces:**
- Produces: `processPhoto(input: string | Buffer): Promise<{ full: Buffer, thumb: Buffer }>`

- [ ] **Step 1: Write the failing tests** — images générées avec `sharp({ create: … })` :
  - paysage 1200×800 opaque → `full` JPEG 720×720, `thumb` JPEG 240×240 (vérifier via `sharp(buf).metadata()` : `format === 'jpeg'`, dimensions).
  - PNG 500×500 entièrement transparent → pixel central de `full` blanc (≥ 250 sur R, G, B via `.raw()`).
  - petite image 100×150 → toujours 720×720 (agrandie).
- [ ] **Step 2:** `node --test scripts/` → FAIL.
- [ ] **Step 3:** Implémenter : `.rotate()` (EXIF) → `.flatten({ background: '#ffffff' })` → `.resize(720, 720, { fit: 'cover', position: 'attention' })` → `.jpeg({ quality: 85 })` ; vignette = `sharp(full).resize(240, 240).jpeg({ quality: 85 })`.
- [ ] **Step 4:** `node --test scripts/` → PASS.
- [ ] **Step 5:** Commit `feat(generer-serie): recadrage des photos avec sharp`.

### Task 3: Import vers Supabase

**Files:**
- Create: `scripts/import-serie/importer.mjs`
- Test: `scripts/import-serie/importer.test.mjs` (client Supabase factice en mémoire)

**Interfaces:**
- Consumes: Task 1 (`parseManifest` résultat, `photoPaths`, `nextNumbers`, `sameName`), Task 2 (`processPhoto`).
- Produces: `importSeries(manifest: Manifest, sb: SupabaseClient, opts?: { dryRun?: boolean, now?: () => number }): Promise<Report>`
  - `Report = { set: { id: number|null, name: string, created: boolean }, created: { name, number }[], skipped: { name, reason: string }[], noPhoto: string[], failed: { name, error: string }[] }`

Comportement :
1. Rareté : `rarities` où `code = manifest.rarity` ; absente → `Error`.
2. Série : `card_sets` par `name` ; absente → insertion `{ name, in_boosters: false }` (`created: true`). En `dryRun`, pas d'insertion, `id: null`.
3. Cartes existantes de la série (`name, number`) ; les cartes du manifeste dont le nom existe (`sameName`) vont dans `skipped` avec `reason: 'déjà présente'`.
4. Numéros via `nextNumbers` sur les restantes, dans l'ordre du manifeste.
5. Par carte : photo absente ou fichier introuvable → `noPhoto`, chemins `null` ; sinon `processPhoto` puis envoi des deux fichiers. Insertion `{ set_id, number, name, subtitle, description, rarity_id, stats: numero != null ? { numero } : {}, image_path, thumb_path, is_released: false, in_boosters: true }`. Erreur d'insertion → suppression des fichiers envoyés (`storage.remove`), entrée dans `failed`, on continue.
6. `dryRun` : étapes 1, 3, 4 et le traitement des photos s'exécutent (pour valider les fichiers), rien n'est écrit ; `created` liste ce qui serait créé.

- [ ] **Step 1: Write the failing tests** avec un faux client couvrant `from(t).select/eq/insert/single` et `storage.from(b).upload/remove`, qui enregistre les appels :
  - série inconnue → insertion `card_sets` avec `in_boosters: false`, cartes numérotées 1..n, `is_released: false`, `stats: { numero: 9 }`, uploads vers `card-images` avec `cacheControl: '604800'` et `upsert: false`.
  - série existante avec une carte « Earvin Ngapeth » n°4 → manifeste [« earvin ngapeth », « Trévor Clévenot »] : 1 `skipped`, Clévenot reçoit le n°5.
  - `photo: 'C:/inexistant.jpg'` → carte insérée avec `image_path: null`, nom dans `noPhoto`.
  - insertion de carte qui échoue → `storage.remove` appelé avec les deux chemins de cette carte, entrée dans `failed`, carte suivante quand même créée.
  - `dryRun: true` → aucun `insert` ni `upload` enregistré, `created` non vide.
  - rareté `'inconnue'` → rejet avec message contenant `inconnue`.
- [ ] **Step 2:** `node --test scripts/` → FAIL.
- [ ] **Step 3:** Implémenter `importer.mjs`.
- [ ] **Step 4:** `node --test scripts/` → PASS.
- [ ] **Step 5:** Commit `feat(generer-serie): import des cartes dans Supabase`.

### Task 4: CLI, configuration et skill

**Files:**
- Create: `scripts/import-serie.mjs`
- Create: `.claude/skills/generer-serie/SKILL.md`
- Modify: `.env.example`, `README.md`

**Interfaces:**
- Consumes: `parseManifest` (Task 1), `importSeries` (Task 3).
- Produces: commande `node scripts/import-serie.mjs <manifeste.json> [--dry-run]`.

- [ ] **Step 1:** CLI : `process.loadEnvFile('.env.local')` (fichier absent → message), lecture + `parseManifest` du JSON (chemins `photo` relatifs résolus par rapport au dossier du manifeste), `createClient(url, key, { auth: { persistSession: false } })`, `importSeries`, affichage du rapport en français (série créée ou réutilisée, cartes créées avec numéro, ignorées, sans photo, échecs), rappel « Cartes en préparation : publie-les depuis /admin > Cartes, et active la série dans les boosters ». Code de sortie 1 si `failed` non vide ou erreur.
- [ ] **Step 2:** `.env.example` : bloc commenté `SUPABASE_SERVICE_ROLE_KEY=` (Project Settings > API Keys > secret ; ne jamais préfixer par `VITE_`, utilisée seulement par `scripts/import-serie.mjs`). README : section « Générer une série » (demander à Claude Code, clé à renseigner, `--dry-run`, cartes en préparation).
- [ ] **Step 3: Vérifier** sans clé : `node scripts/import-serie.mjs x.json` avec un `.env.local` sans `SUPABASE_SERVICE_ROLE_KEY` → message nommant la variable et où la trouver, exit 1. Manifeste invalide → liste des problèmes, exit 1.
- [ ] **Step 4:** `SKILL.md` (frontmatter `name: generer-serie`, `description:` déclenchement sur « génère une série / des cartes sur … »). Contenu, dans l'ordre :
  1. Extraire de la demande : thème, nom de série (proposer si absent), rareté (`common` par défaut ; codes : common, uncommon, rare, ultra_rare, legendary, secret).
  2. Effectif actuel via WebSearch/WebFetch (Wikipédia FR/EN en priorité) : nom, poste, numéro, club, 2–3 faits.
  3. Photo par joueur, toute source ; portrait net, visage visible ; télécharger dans un dossier neuf du scratchpad (`photos/<slug>.jpg`) ; ouvrir chaque image avec Read pour vérifier que c'est le bon joueur et un portrait exploitable.
  4. Rédiger `subtitle` = poste en français (Passeur, Pointu/Opposé, Réceptionneur-attaquant, Central, Libéro), `description` = 1–2 phrases, ton carte à collectionner, sans stats.
  5. Aperçu obligatoire : tableau nom / poste / n° / description / source photo + joueurs sans photo ; attendre la validation.
  6. Écrire `manifest.json` (format de la spec) à côté des photos, lancer d'abord `--dry-run`, puis l'import réel.
  7. Rapporter le résultat et rappeler la publication depuis `/admin`.
- [ ] **Step 5:** `npm run typecheck` et `node --test scripts/` → PASS. Commit `feat(generer-serie): commande d'import et skill Claude`.
