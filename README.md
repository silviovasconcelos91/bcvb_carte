# Cartes du BCVB

Jeu de cartes à collectionner du club : boosters, collection, échanges entre membres, et une console d'administration.

- `/` : le jeu
- `/admin` : la console d'administration, chargée à part et réservée aux comptes inscrits dans la table `admins`

React 19, TypeScript et Vite pour le site ; Supabase (PostgreSQL, authentification, stockage des photos) pour le reste. Il n'y a aucun serveur à héberger : toutes les règles du jeu sont appliquées par la base.

## Lancer en local

Il faut Node.js 20.19 ou plus récent (22 recommandé).

```bash
npm install
cp .env.example .env.local   # puis renseigne l'URL, la clé publishable et VITE_LOGIN_EMAIL_DOMAIN
npm run dev
```

Sans `VITE_SUPABASE_URL` ni `VITE_SUPABASE_PUBLISHABLE_KEY`, le site tourne en **mode démo** : membres et cartes fictifs, gardés dans le navigateur. C'est pratique pour travailler sur l'interface sans toucher aux vraies données.

`npm run build` vérifie les types (`tsc`) puis construit le site dans `dist/`.

## Préparer Supabase

1. Sur un projet neuf, exécute `supabase/schema.sql` dans le SQL Editor.
   Si tu avais lancé une version précédente, exécute plutôt les migrations dans l'ordre : `migration_cartes_cachees.sql` (seulement si tu partais de la toute première version), puis `migration_admin.sql`.
2. Exécute `supabase/migration_vignettes.sql`, qui ajoute la vignette des cartes (colonne `cards.thumb_path` et droit de lecture dans le bucket).
   Chaque photo envoyée depuis la console existe en deux tailles : 720 px pour les grands affichages (carte retournée, fiche détaillée) et une vignette de 240 px, environ six fois plus légère, pour le classeur et les listes. Les URL signées valent 7 jours et sont gardées dans le navigateur, qui réutilise donc son cache au lieu de retélécharger les photos à chaque visite.
3. Exécute `supabase/migration_inscriptions.sql` (après `migration_cartes_possedees.sql`), qui ajoute le statut des comptes et le code d'inscription du club.
4. Dans Authentication, réglages de connexion par e-mail :
   - **Allow new users to sign up** : activé, les membres créent eux-mêmes leur compte ;
   - **Confirm email** : désactivé, aucun e-mail n'est envoyé (les adresses des comptes sont fictives) ;
   - longueur minimale des mots de passe : **8 caractères**.
5. Crée ton compte administrateur (Authentication > Users > Add user, avec ta vraie adresse et un mot de passe), puis nomme-toi administrateur :

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'toi@exemple.fr';
```

6. Choisis le code d'inscription du club dans la console, onglet Réglages (ou en SQL : `update public.signup_settings set code = 'BCVB-2026' where id;`).

### Comptes des membres

Chaque membre crée son compte depuis le site avec un **pseudo** et un **mot de passe**. Supabase identifiant un compte par une adresse e-mail, le pseudo est converti en adresse interne : « Léa Martin » devient `cartes-lea.martin@<VITE_LOGIN_EMAIL_DOMAIN>`. On se reconnecte ensuite avec « léa martin », « Lea.Martin »… : majuscules, accents et espaces ne comptent pas. Deux pseudos qui donnent le même identifiant ne peuvent pas coexister.

- Avec le **code du club**, le compte est actif tout de suite.
- Sans code, ou avec un mauvais code, il reste **en attente** : le membre ne voit rien du jeu tant qu'un administrateur ne l'a pas validé dans la console, onglet Membres. Le tableau de bord signale les comptes en attente.
- Les administrateurs se connectent à `/admin` avec leur vraie adresse e-mail et leur mot de passe.

`VITE_LOGIN_EMAIL_DOMAIN` doit être un **vrai domaine avec des enregistrements MX**, de préférence celui du club (par exemple `bcvb.fr`) : Supabase refuse `example.com`, `test.com` ou `localhost`. Les adresses n'ont pas besoin d'exister, aucun e-mail n'y est envoyé.

**Mot de passe oublié.** Sans e-mail, pas de lien de réinitialisation : un administrateur en redonne un depuis son poste, avec `LOGIN_EMAIL_DOMAIN` (même valeur que `VITE_LOGIN_EMAIL_DOMAIN`) dans `.env.admin` :

```bash
npm run reset-password -- "Léa Martin"                  # génère et affiche un mot de passe
npm run reset-password -- "Léa Martin" "NouveauMotDePasse"
```

Un membre connecté change lui-même son mot de passe et son pseudo affiché en cliquant sur son pseudo, en haut du jeu.

## Déployer sur Vercel

1. Pousse ce dossier sur un dépôt GitHub (ou GitLab, Bitbucket).
2. Sur vercel.com : **Add New > Project**, importe le dépôt. Vite est détecté automatiquement ; `vercel.json` fixe déjà la commande de build et le dossier `dist`.
3. Avant de déployer, ajoute les variables d'environnement (Settings > Environment Variables) :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_LOGIN_EMAIL_DOMAIN` (voir « Comptes des membres »)
   - éventuellement `VITE_CLUB_NAME`, `VITE_CLUB_SHORT`, `VITE_APP_URL`

   Ces variables sont intégrées au moment du build : après toute modification, relance un déploiement.
4. Déploie. Chaque `git push` sur la branche principale redéploie ensuite le site automatiquement.

Tu peux aussi déployer depuis ton poste avec la CLI : `npx vercel` (prévisualisation) puis `npx vercel --prod`.

La clé publishable peut être publique : ce sont les règles de sécurité de la base qui protègent les données. Ne mets jamais la clé secrète dans une variable `VITE_…`, elle se retrouverait dans le code envoyé aux navigateurs.

## Organisation du code

```
src/
  main.tsx            choix de la page (/ ou /admin), polices, styles
  config.ts           lecture des variables d'environnement
  lib/                types, formatage, client Supabase, données de démo
  api/game.ts         accès aux données du jeu (Supabase ou démo)
  api/admin.ts        accès aux données de la console (Supabase ou démo)
  components/         visuels des cartes, fenêtres, notifications
  game/               écrans du jeu : booster, collection, échanges
  admin/              écrans de la console
  styles/             feuilles de style (thème clair et sombre)
supabase/             schéma SQL et migrations
```

Chaque écran passe par une interface (`GameApi`, `AdminApi`) qui a deux implémentations : Supabase et démo. La démo reproduit les règles de `schema.sql` (tirage pondéré, codes, échanges, cartes masquées) pour que l'interface se comporte de la même façon dans les deux modes.

Si tu veux des types générés à partir de la base plutôt que ceux écrits à la main dans `src/lib/types.ts`, la CLI Supabase sait les produire : `npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts`.
