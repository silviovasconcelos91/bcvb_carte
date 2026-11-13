# Génération automatique d'une série de cartes

## Intention

Créer une série complète à partir d'une seule demande faite à Claude Code, par exemple :
« génère les cartes communes d'une nouvelle série sur l'équipe de France de volley ».
Claude retrouve l'effectif, récupère une photo par joueur, rédige les textes et crée les cartes.
Seul l'administrateur s'en sert, depuis Claude Code. Rien n'est ajouté au site.

## Objectifs / non-objectifs

- Objectifs : effectif trouvé sur le web (Wikipédia ou équivalent), une photo et une description par
  joueur, cartes insérées dans Supabase avec photo (720 px) et vignette (240 px).
- Non-objectifs : pas de stats, pas de bouton dans la console, pas d'usage par d'autres admins.
- Anti-objectif : publier des cartes sans relecture. Les cartes sont créées **en préparation**
  (`is_released = false`) et publiées depuis la console.

## Approches considérées

- **A. Skill + script d'import (retenue).** Le skill décrit la démarche, et un script Node fait l'import
  de façon reproductible. Choisie par l'utilisateur.
- B. Skill seul : appels Supabase réécrits à chaque fois. Fragile, écartée.
- C. Skill + bouton d'import dans la console : pas de clé service_role, mais du travail d'interface et une
  étape manuelle. Écartée.

## Conception

### Skill `.claude/skills/generer-serie/SKILL.md`

Étapes suivies par Claude :
1. Comprendre la demande : thème, nom de la série, rareté (par défaut `Commune`, id 1).
2. Chercher l'effectif actuel (WebSearch/WebFetch) : nom, poste, numéro de maillot, club, quelques faits
   (âge, palmarès, sélections).
3. Trouver une photo par joueur, n'importe quelle source, en privilégiant un portrait net où le visage
   est bien visible. Téléchargement dans le dossier de travail de la session.
4. Rédiger pour chaque carte : `name`, `subtitle` = poste en français (« Passeur », « Réceptionneur-attaquant »…),
   `description` = 1 à 2 phrases, ton carte à collectionner, `stats` = `{ numero }` seulement.
5. **Aperçu avant import** : tableau nom / poste / numéro / description / source de la photo, et
   les photos ouvertes pour vérification. L'utilisateur valide ou corrige.
6. Écrire le manifeste JSON et lancer le script.
7. Rapport : cartes créées, joueurs sans photo, rappel de publier depuis `/admin`.

### Script `scripts/import-serie.mjs`

`node scripts/import-serie.mjs <manifeste.json> [--dry-run]`

Manifeste :
```json
{
  "set": "Équipe de France de volley",
  "rarity": "common",
  "cards": [
    { "name": "Earvin Ngapeth", "subtitle": "Réceptionneur-attaquant", "description": "…",
      "numero": 9, "photo": "C:/…/ngapeth.jpg" }
  ]
}
```

- Lit `VITE_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` dans `.env.local`. Sans préfixe `VITE_`, la clé
  n'est jamais incluse dans le site.
- Série : la réutilise si le nom existe, sinon la crée. Elle est créée avec `in_boosters = false`
  pour qu'aucune carte ne tombe tant que l'utilisateur ne l'a pas activée.
- Numéros : à la suite du plus grand `number` déjà présent dans la série.
- Photo : `sharp`, carré de 720 px cadré avec `position: 'attention'` (zone la plus saillante, en général
  le visage), JPEG qualité 85, plus une vignette de 240 px tirée du même carré. Chemins au même format que
  la console : `<set_id>/<slug>-<base36>.jpg` et `.thumb.jpg`, mêmes options d'envoi (`cacheControl: 604800`).
- Insertion dans `cards` avec `is_released = false`, `in_boosters = true`.
- Joueur sans photo : carte créée sans image et signalée dans le rapport.
- Doublon (même nom dans la série) : ignoré et signalé, pour pouvoir relancer sans tout dupliquer.
- `--dry-run` : contrôle le manifeste et les photos sans rien écrire.

### Dépendance et configuration

- `sharp` en devDependency.
- `.env.example` : ajout de `SUPABASE_SERVICE_ROLE_KEY=` avec un commentaire (clé secrète, jamais `VITE_`).
- README : courte section « Générer une série ».

## Laissé à l'implémentation

Le slug et la forme exacte du rapport, la gestion des formats d'image exotiques (WebP, PNG avec transparence → fond blanc
comme la console), et les messages d'erreur.
