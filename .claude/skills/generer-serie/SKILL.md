---
name: generer-serie
description: Génère et importe une série de cartes à partir d'un thème (« génère les cartes communes d'une nouvelle série sur l'équipe de France de volley »). Cherche l'effectif sur le web, récupère une photo par personne, rédige poste et description, montre un aperçu puis importe dans Supabase via scripts/import-serie.mjs. À utiliser dès qu'on demande de créer, générer ou importer des cartes ou une série sur un groupe de personnes.
---

# Générer une série de cartes

Les cartes arrivent **en préparation** (invisibles, jamais tirées) ; l'utilisateur les publie lui-même depuis `/admin`. Aucune étape n'écrit dans la base avant sa validation de l'aperçu.

## 1. Comprendre la demande

Extraire :
- **le thème** : qui doit figurer dans la série ;
- **le nom de la série** : s'il n'est pas donné, en proposer un court (« Équipe de France de volley 2026 ») dans l'aperçu ;
- **la rareté** : `common` par défaut. Codes : `common` (Commune), `uncommon` (Peu commune), `rare`, `ultra_rare`, `legendary` (Légendaire), `secret` (Secrète).

Pas de stats : seul le numéro de maillot va dans la carte.

## 2. Trouver l'effectif

WebSearch puis WebFetch, Wikipédia FR en priorité (sinon EN, site officiel de la fédération ou du club). Prendre l'effectif **actuel** et noter la date de la source. Pour chaque personne : nom complet, poste, numéro de maillot, club actuel, 2 ou 3 faits marquants (âge, palmarès, sélections, surnom).

## 3. Récupérer les photos

N'importe quelle source convient (Wikimedia Commons, site du club ou de la fédération, presse…). Viser un portrait net où le visage est bien visible, de préférence en tenue de l'équipe.

- Créer un dossier neuf dans le scratchpad, par exemple `<scratchpad>/serie-<slug>/photos/`, et y télécharger chaque photo sous `photos/<slug-du-nom>.<ext>` (curl avec `-L` et un User-Agent de navigateur générique).
- **Ouvrir chaque image avec Read** pour vérifier que c'est la bonne personne, que le fichier est bien une image (pas une page HTML d'erreur) et que le visage est exploitable. Sinon chercher une autre photo.
- Si rien de correct n'est trouvé, laisser la personne sans photo et le dire dans l'aperçu.

## 4. Rédiger les cartes

- `name` : prénom et nom.
- `subtitle` : poste en français. Volley : Passeur, Pointu, Réceptionneur-attaquant, Central, Libéro (au féminin pour une équipe féminine : Passeuse, Centrale…). Autre sport : le poste usuel en français.
- `description` : 1 à 2 phrases, ton carte à collectionner, factuelles (club, palmarès, trait marquant). Pas de stats, pas d'information non vérifiée.
- `numero` : numéro de maillot (entier 0–99), sinon l'omettre.

## 5. Aperçu obligatoire

Montrer à l'utilisateur, avant tout import :
- le nom de la série, la rareté, la source de l'effectif et sa date ;
- un tableau : n° de maillot / nom / poste / description / source de la photo ;
- les personnes sans photo.

Attendre sa validation. Appliquer ses corrections.

## 6. Importer

Écrire `manifest.json` à côté du dossier `photos/` :

```json
{
  "set": "Équipe de France de volley 2026",
  "rarity": "common",
  "cards": [
    { "name": "Earvin Ngapeth", "subtitle": "Réceptionneur-attaquant", "description": "…", "numero": 9, "photo": "photos/earvin-ngapeth.jpg" }
  ]
}
```

Les chemins `photo` sont relatifs au manifeste. Puis, depuis la racine du projet :

1. `node scripts/import-serie.mjs <chemin>/manifest.json --dry-run` : corriger tout problème signalé ;
2. `node scripts/import-serie.mjs <chemin>/manifest.json`.

Si le script dit que `VITE_SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY` manque dans `.env.local`, s'arrêter et demander à l'utilisateur de la renseigner (Supabase > Project Settings > API Keys). Ne jamais lire, afficher ni écrire cette clé soi-même.

## 7. Rapport

Résumer : série créée ou réutilisée, cartes créées avec leur numéro, ignorées (déjà présentes), sans photo, échecs. Rappeler :
- publier les cartes depuis `/admin` > Cartes ;
- activer la série dans les boosters si elle vient d'être créée ;
- corriger un recadrage raté depuis la console.
