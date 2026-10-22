# Propositions de cartes — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les membres proposent des cartes (photo recadrée, nom, rareté non secrète…) depuis un onglet du jeu, voient leurs propositions en attente (5 max) ; l'admin les intègre en préparation ou les refuse depuis un onglet de la console.

**Architecture:** Nouvelle table `card_proposals`, protégée par la RLS et par un déclencheur qui applique les règles (limite, rareté, compte actif, dossier photo). Les photos vont dans le bucket existant `card-images`, sous `proposals/<uid>/`. Le formulaire et le recadrage photo de l'éditeur de la console sont extraits dans un composant partagé, utilisé par l'onglet « Proposer » du jeu et par l'éditeur de la console, qui gagne un mode « intégration ».

**Tech Stack:** React 19 + TypeScript 5.9 + Vite 8, Supabase (Postgres, RLS, Storage), CSS maison (`src/styles/base.css`, `src/styles/admin.css`).

**Spec:** `docs/superpowers/specs/2026-10-22-propositions-cartes-design.md`

## Global Constraints

- Le projet n'a **aucun lanceur de tests** et le plan n'en ajoute pas. La vérification se fait par `npx tsc --noEmit`, `npm run build`, des requêtes SQL et des parcours manuels en mode démo, avec les résultats attendus écrits dans chaque tâche.
- Limite : **5** propositions en attente par membre (`PROPOSAL_MAX = 5`). Plafond de stockage : **10** fichiers dans `proposals/<uid>/`.
- Rareté proposable : uniquement `rarities.is_secret = false`.
- Message de limite, mot pour mot : « Tu as déjà 5 propositions en cours d'examen. Tu pourras en proposer d'autres quand l'une d'elles aura été examinée. »
- Une proposition intégrée devient une carte **en préparation** (`is_released = false`). La photo reste celle du membre : pas de recadrage ni de remplacement à l'intégration.
- Intégration ou refus = **suppression** de la ligne `card_proposals`. Pas de statut, aucune information de décision visible par le membre.
- Le refus supprime aussi les photos. L'intégration réutilise les chemins photo tels quels, sans copie.
- Chemins photo : `proposals/<uid>/<slug(nom)>-<Date.now().toString(36)>.jpg` et `….thumb.jpg` (720 px et 240 px, comme l'éditeur actuel).
- Tout changement SQL va **à la fois** dans `supabase/schema.sql` (nouvelle section 10, juste avant « 9. Données de départ ») et dans le patch rejouable `supabase/patches/2026-10-22-propositions.sql`, avec l'en-tête habituel des patchs.
- Textes de l'interface en français, ton « tu ». Commentaires en français, avec la densité du code voisin.

## Review Focus

1. **6ᵉ proposition envoyée en contournant l'interface** (appel API direct) : la base la refuse avec le message de limite. *Vérifié par la tâche 1, étape 4.*
2. **Rareté secrète, ou photo hors de son dossier, envoyée par API** : la base refuse. *Tâche 1, étape 4.*
3. **Photo envoyée mais insertion refusée** (limite atteinte entre l'affichage et l'envoi) : le membre voit le message d'erreur, sa liste reste inchangée, les fichiers restent orphelins (limite connue, pas d'erreur bloquante). *Tâche 3, étape 4.*
4. **Un membre lit la photo de la proposition d'un autre membre** (chemin deviné) : la signature d'URL échoue. *Tâche 1, étape 4.*
5. **Carte intégrée puis publiée** : sa photo, restée sous `proposals/`, est visible des membres qui la possèdent, via la règle existante « cartes possédées ». *Tâche 6, étape 5.*

---

### Task 1: Base de données — table, règles, stockage

**Files:**
- Modify: `supabase/schema.sql` (nouvelle section « 10. Propositions de cartes », insérée avant la section 9)
- Create: `supabase/patches/2026-10-22-propositions.sql` (même contenu, rejouable)

**Interfaces:**
- Produces : table `public.card_proposals(id bigint identity pk, user_id uuid not null references profiles on delete cascade, created_at timestamptz not null default now(), name text not null check (char_length(name) between 1 and 40), subtitle text check (char_length(subtitle) <= 40), description text check (char_length(description) <= 160), stats jsonb not null default '{}', rarity_id smallint not null references rarities, image_path text not null, thumb_path text not null)`.

- [ ] **Step 1 : table et droits.** Créer la table ci-dessus, avec un index sur `user_id`. Appliquer `revoke all … from anon, authenticated`, puis `grant select, insert, delete … to authenticated`, et activer la RLS. Policies :
  - « Membres : proposer une carte » : `for insert to authenticated with check (user_id = (select auth.uid()))` ;
  - « Membres : lire ses propositions » : `for select to authenticated using (user_id = (select auth.uid()))` ;
  - « Admin : lire les propositions » : select, avec `(select public.is_admin())` ;
  - « Admin : supprimer les propositions » : delete, avec `(select public.is_admin())`.
- [ ] **Step 2 : déclencheur `private.check_card_proposal()`**, `before insert`, `language plpgsql set search_path = ''`. Il lève une exception, dans cet ordre :
  - si le profil `new.user_id` n'est pas `active` : « Compte en attente de validation » ;
  - si la rareté n'existe pas ou si `is_secret` : « Cette rareté ne peut pas être proposée » ;
  - si le membre a déjà `>= 5` lignes dans `card_proposals` : le message de limite exact des contraintes globales ;
  - si `image_path` ou `thumb_path` ne commence pas par `'proposals/' || new.user_id || '/'` : « Photo invalide ».

  Il force aussi `new.created_at = now()`.
- [ ] **Step 3 : stockage et sous-titres.**
  - Fonction `rls.proposal_file_count()`, `security definer stable` : renvoie le nombre d'objets du bucket `card-images` dont le nom commence par `'proposals/' || auth.uid() || '/'`. Elle est en `security definer` pour compter aussi les fichiers orphelins, invisibles par RLS. `revoke … from public, anon` puis `grant execute … to authenticated`.
  - Policy « Membres : déposer les photos de leurs propositions » sur `storage.objects`, `for insert to authenticated with check`, avec toutes ces conditions :
    - `bucket_id = 'card-images'` ;
    - `(storage.foldername(name))[1] = 'proposals'` ;
    - `(storage.foldername(name))[2] = (select auth.uid())::text` ;
    - `(select rls.is_active())` ;
    - `(select rls.proposal_file_count()) < 10`.
  - Policy « Membres : voir les photos de leurs propositions », `for select` : `bucket_id = 'card-images'` et il existe une proposition du membre connecté dont `image_path` ou `thumb_path` vaut `objects.name`.
  - Policy « Membres : lire les sous-titres » sur `public.card_subtitles`, `for select to authenticated using ((select rls.is_active()))`.
- [ ] **Step 4 : vérifier dans Supabase SQL Editor** (à faire par l'humain si l'implémenteur n'a pas accès : livrer le patch et la liste ci-dessous). Exécuter le patch deux fois : aucune erreur la seconde fois. En se faisant passer pour un membre actif `M` (`set local role authenticated; set local request.jwt.claims = '{"sub":"<uid M>"}';`, dans une transaction annulée ensuite), vérifier :
  - 5 `insert` valides passent, le 6ᵉ échoue avec le message de limite ;
  - un `insert` avec une rareté `is_secret = true` échoue : « Cette rareté ne peut pas être proposée » ;
  - un `insert` avec `image_path = 'proposals/<autre uid>/x.jpg'` échoue : « Photo invalide » ;
  - `select * from card_proposals` ne renvoie que les lignes de `M` ;
  - `delete from card_proposals` ne supprime rien (0 ligne).
- [ ] **Step 5 : commit**
```bash
git add supabase/schema.sql supabase/patches/2026-10-22-propositions.sql
git commit -m "feat(db): table card_proposals, règles et stockage des propositions"
```

### Task 2: Formulaire de carte partagé (refacto sans changement de comportement)

**Files:**
- Create: `src/components/CardForm.tsx`
- Modify: `src/admin/Cards.tsx` (le `CardEditor` utilise le module partagé)
- Modify: `src/lib/types.ts` (le type `Photo` y est déplacé)
- Modify: `src/api/admin.ts` (importe `Photo` depuis `../lib/types`)
- Modify: `src/styles/admin.css` → `src/styles/base.css` (déplacer les règles `.field*`, `.check*`, `.editor*`, `.row2`, `.fs*`, `.stat-row*`, `.photo-row`, `.file-btn*`, `.crop*`, qui servent maintenant aussi au jeu)

**Interfaces:**
- Produces (`src/components/CardForm.tsx`) :
  - `export interface CardDraft { name: string; subtitle: string; description: string; rarity_id: number; numero: string; stats: { k: string; v: number }[] }`
  - `export function draftFrom(c: Pick<Card, 'name' | 'subtitle' | 'description' | 'rarity_id' | 'stats'> | null, rarityId: number): CardDraft` : même logique que l'actuel `toDraft` pour ces champs (4 lignes de stats, valeur 5 par défaut).
  - `export function draftFields(d: CardDraft): Pick<Card, 'name' | 'subtitle' | 'description' | 'rarity_id' | 'stats'>` : noms et textes nettoyés (`trim`, chaîne vide → `null`), et `stats` construit comme l'actuel `toInput` (numéro de maillot borné de 0 à 99).
  - `export function useCardPhoto(): { img: HTMLImageElement | null; crop: Crop; setCrop(c: Crop): void; dataUrl: string | null; pick(e: ChangeEvent<HTMLInputElement>): void; clear(): void; exportPhoto(): Promise<Photo | null> }`, avec `type Crop = { zoom: number; px: number; py: number }`. Il reprend `drawCrop`, `thumbOf`, `toJpeg` et les messages d'erreur actuels (`toast`).
  - `export function CardFields({ draft, onChange, rarities, subtitles }: { draft: CardDraft; onChange(d: CardDraft): void; rarities: Rarity[]; subtitles: Subtitle[] })` : rend Nom, Sous-titre et Rareté, la `datalist` des sous-titres, le bloc Statistiques et la Description, avec le balisage, les `maxLength` et les textes actuels.
  - `export function PhotoField({ photo, canRemove, onRemove }: { photo: ReturnType<typeof useCardPhoto>; canRemove: boolean; onRemove(): void })` : rend le bloc « Photo » actuel (bouton de choix, bouton « Retirer la photo », réglages de recadrage, texte d'aide).
- `Photo` est désormais exporté par `src/lib/types.ts`.

- [ ] **Step 1 : créer `CardForm.tsx`** avec les exports ci-dessus, en déplaçant le code de `Cards.tsx` sans changer la logique.
- [ ] **Step 2 : réécrire `CardEditor`** sur cette base. Le `Draft` de la console devient `CardDraft & { set_id: number; number: string; is_released: boolean; in_boosters: boolean }`. Le balisage final de la modale doit rester identique : même ordre des champs, mêmes classes, mêmes textes.
- [ ] **Step 3 : déplacer le CSS** listé de `admin.css` vers `base.css`, à la suite des styles de formulaire existants, sans modifier les déclarations.
- [ ] **Step 4 : vérifier.**
  - `npx tsc --noEmit` ne renvoie aucune sortie, et `npm run build` affiche `✓ built`.
  - En démo (`.env.local` sans clés Supabase, ou `VITE_SUPABASE_URL` vide), sur `/admin` → Cartes : « Nouvelle carte » puis « Modifier » une carte. Les champs, le recadrage, l'aperçu en direct et l'enregistrement se comportent comme avant.
- [ ] **Step 5 : commit**
```bash
git add src/components/CardForm.tsx src/admin/Cards.tsx src/lib/types.ts src/api/admin.ts src/styles/admin.css src/styles/base.css
git commit -m "refactor: formulaire et recadrage de carte partagés (CardForm)"
```

### Task 3: API du jeu — proposer, lister ses propositions, sous-titres

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/api/game.ts` (interface `GameApi`, implémentation Supabase et implémentation démo)

**Interfaces:**
- Produces (`src/lib/types.ts`) : `export interface Proposal { id: number; user_id: string; created_at: string; name: string; subtitle: string | null; description: string | null; stats: Stats; rarity_id: number; image_path: string; thumb_path: string }` et `export type ProposalInput = Pick<Proposal, 'name' | 'subtitle' | 'description' | 'stats' | 'rarity_id'>`.
- Produces (`src/api/game.ts`) :
  - `export const PROPOSAL_MAX = 5;`
  - `export const PROPOSAL_LIMIT_MSG = "Tu as déjà 5 propositions en cours d'examen. Tu pourras en proposer d'autres quand l'une d'elles aura été examinée.";`
  - Dans `GameApi` :
    - `myProposals(): Promise<Proposal[]>` (plus anciennes d'abord) ;
    - `propose(uid: string, input: ProposalInput, photo: Photo): Promise<void>` ;
    - `subtitles(): Promise<Subtitle[]>`.

- [ ] **Step 1 : Supabase.**
  - `myProposals` : `select('*')` sur `card_proposals`, `order('created_at')`. La RLS ne renvoie que celles du membre.
  - `subtitles` : `card_subtitles`, `order('label')`. En cas d'erreur, renvoyer `[]`, comme la console.
  - `propose` :
    1. compter ses propositions et lever `PROPOSAL_LIMIT_MSG` si le compte est `>= PROPOSAL_MAX`, **avant** tout envoi de fichier ;
    2. envoyer `full` puis `thumb` aux chemins des contraintes globales (`upsert: false`, `contentType: 'image/jpeg'`) ;
    3. insérer la ligne. Les erreurs remontent telles quelles, via `must`.
- [ ] **Step 2 : démo.**
  - Ajouter `proposals: Proposal[]` au `DemoDb` du jeu, initialisé à `[]` à la lecture d'un stockage ancien (`db.proposals ??= []`, sans changer la clé de stockage).
  - `myProposals` : filtrer sur `db.current`.
  - `propose` : appliquer les mêmes règles que la base (limite, rareté non secrète), avec des chemins fictifs. La démo n'affiche pas les photos ; c'est le comportement actuel de `imageUrls` en démo.
  - `subtitles` : renvoyer `DEMO_SUBTITLES` (déjà dans `src/lib/demoData.ts`).
- [ ] **Step 3 : vérifier.** `npx tsc --noEmit` ne renvoie aucune sortie.
- [ ] **Step 4 : vérifier le chemin d'erreur** (Review Focus 3). Dans `propose`, si l'insertion échoue après l'envoi des photos, l'erreur remonte sans tentative de suppression des fichiers (le membre n'a pas ce droit), et rien n'est ajouté à la liste. Écrire un commentaire d'une ligne qui le dit, au-dessus de l'insertion.
- [ ] **Step 5 : commit**
```bash
git add src/lib/types.ts src/api/game.ts
git commit -m "feat(api): propositions de cartes côté jeu"
```

### Task 4: Onglet « Proposer » du jeu

**Files:**
- Create: `src/game/ProposeView.tsx`
- Modify: `src/game/context.ts` (`Tab` gagne `'propose'`)
- Modify: `src/game/Header.tsx` (onglet `['propose', 'Proposer']`, après Classement)
- Modify: `src/game/GameApp.tsx` (`{tab === 'propose' && <ProposeView />}`)
- Modify: `src/styles/base.css` (mise en page de la vue)

**Interfaces:**
- Consumes : `useCardPhoto`, `CardFields`, `PhotoField`, `draftFrom`, `draftFields` (tâche 2) ; `api.myProposals`, `api.propose`, `api.subtitles`, `api.imageUrls`, `PROPOSAL_MAX`, `PROPOSAL_LIMIT_MSG` (tâche 3) ; `partialCard` (`src/api/game.ts`) ; `CardView` et `LookupContext`.

- [ ] **Step 1 : vue.**
  - Au montage, charger `myProposals()` et `subtitles()`, puis signer les chemins des photos avec `api.imageUrls`.
  - Section « Proposer une carte » :
    - `CardFields`, avec `rarities = d.rarities.filter(r => !r.is_secret)` ;
    - `PhotoField` ;
    - un aperçu en direct, selon le schéma de `previewLookup` de la console : URL `__draft__`, `set_id: 0`, `number: null` ;
    - un bouton « Proposer ».
  - Validation avant envoi : il faut un nom (« Donne un nom à la carte. ») et une photo (« Ajoute une photo. »).
  - Bouton **désactivé** quand le nombre de propositions est `>= PROPOSAL_MAX` ou pendant l'envoi. Dans le premier cas, afficher `PROPOSAL_LIMIT_MSG` sous le bouton.
  - Après un envoi réussi : toast « Merci ! Ta proposition a été envoyée. », formulaire et photo réinitialisés, liste rechargée.
  - Section « Mes propositions en attente (n / 5) » : une grille de `CardView` construites par `partialCard` à partir de chaque proposition, avec en dessous la date (`relTime`). Si la liste est vide : « Aucune proposition en attente. »
- [ ] **Step 2 : brancher l'onglet** (context, Header, GameApp).
- [ ] **Step 3 : vérifier.**
  - `npm run build` affiche `✓ built`.
  - En démo, dans le jeu : l'onglet « Proposer » est présent ; le sélecteur de rareté ne liste pas « Secrète » ; envoyer 5 propositions fait passer le compteur à 5 / 5 ; le bouton est alors désactivé et le message de limite s'affiche ; recharger la page conserve la liste.
  - Sur téléphone (fenêtre de 375 px de large), pas de défilement horizontal.
- [ ] **Step 4 : commit**
```bash
git add src/game/ProposeView.tsx src/game/context.ts src/game/Header.tsx src/game/GameApp.tsx src/styles/base.css
git commit -m "feat(jeu): onglet Proposer une carte"
```

### Task 5: API de la console — charger, refuser, intégrer

**Files:**
- Modify: `src/api/admin.ts` (`AdminData`, `AdminApi`, implémentation Supabase et implémentation démo)
- Modify: `src/admin/AdminApp.tsx` (photos des propositions ajoutées aux URL signées)

**Interfaces:**
- Produces :
  - `AdminData.proposals: Proposal[]` (plus anciennes d'abord) ;
  - `AdminApi.refuseProposal(p: Proposal): Promise<void>` ;
  - `AdminApi.integrateProposal(p: Proposal, card: CardInput): Promise<void>`.

- [ ] **Step 1 : Supabase.**
  - `load` : ajouter la lecture de `card_proposals` (`select('*')`, `order('created_at')`). Si la table n'existe pas encore (patch non exécuté), renvoyer `[]`, comme pour `card_subtitles` : la console ne doit pas être bloquée.
  - `refuseProposal` : supprimer la ligne (`ok`), puis `removeFiles([p.image_path, p.thumb_path])`.
  - `integrateProposal` : insérer la carte avec `{ ...card, is_released: false, image_path: p.image_path, thumb_path: p.thumb_path }` (sans `id`), puis supprimer la ligne de proposition. Les deux appels passent par `ok`, et la carte est insérée **en premier** : en cas d'échec de la suppression, la carte existe et la proposition reste visible. Ce cas se repère facilement et vaut mieux qu'une perte.
- [ ] **Step 2 : démo.** Ajouter `proposals: Proposal[]` au `DemoDb` de la console, avec 2 propositions fictives créées par `seed` à partir de membres actifs, et passer `VERSION` à 6. Implémenter `refuseProposal` et `integrateProposal` en mémoire, avec la même règle « en préparation ».
- [ ] **Step 3 : URL signées.** Dans `AdminApp`, `artPaths([...raw.cards, ...raw.proposals])`. `artPaths` accepte tout objet qui a `image_path` et `thumb_path`.
- [ ] **Step 4 : vérifier.** `npx tsc --noEmit` ne renvoie aucune sortie.
- [ ] **Step 5 : commit**
```bash
git add src/api/admin.ts src/admin/AdminApp.tsx
git commit -m "feat(api): propositions de cartes côté console"
```

### Task 6: Onglet « Propositions » de la console et mode intégration

**Files:**
- Create: `src/admin/ProposalsAdmin.tsx`
- Modify: `src/admin/Cards.tsx` (exporter `CardEditor` et lui ajouter la prop `proposal?: Proposal`)
- Modify: `src/admin/context.ts` (`AdminTab` gagne `'proposals'`)
- Modify: `src/admin/AdminApp.tsx` (onglet `['proposals', 'Propositions']` après Cartes, avec le badge du nombre de propositions, rendu, import)
- Modify: `src/admin/Dashboard.tsx` (point « À vérifier »)
- Modify: `src/styles/admin.css`

**Interfaces:**
- Consumes : `d.proposals`, `api.refuseProposal`, `api.integrateProposal` (tâche 5) ; `CardEditor` ; `useRunRefresh` ; `useConfirm` ; `nameOf` ; `relTime` ; `partialCard`.

- [ ] **Step 1 : mode intégration de `CardEditor`.** Quand `proposal` est fourni :
  - titre de la modale : « Intégrer « <nom> » » ;
  - brouillon : `draftFrom(proposal, …)` + série par défaut + prochain numéro libre ;
  - case « Publiée » masquée, `is_released` forcé à `false` ;
  - bloc photo remplacé par le texte « Photo du membre, conservée telle quelle. », et aperçu sur `proposal.image_path` ;
  - pas de bouton « Supprimer » ;
  - `save` appelle `api.integrateProposal(proposal, input)`, avec le message « Carte créée en préparation ».
- [ ] **Step 2 : onglet.**
  - Texte d'introduction : « Cartes proposées par les membres, de la plus ancienne à la plus récente. Une carte intégrée est créée en préparation ; un refus supprime la proposition et sa photo. Le membre n'est pas prévenu de ta décision. »
  - Une grille : `CardView` de la proposition, nom du membre (`nameOf`), date (`relTime`), boutons « Intégrer » (ouvre `CardEditor` en mode intégration) et « Refuser » (confirmation « Refuser la proposition » / « « <nom> » de <membre> sera supprimée, avec sa photo. » / « Refuser », puis `runRefresh(..., 'Proposition refusée')`).
  - Si la liste est vide : « Aucune proposition en attente. »
- [ ] **Step 3 : tableau de bord.** Si `d.proposals.length`, ajouter `['info', plural(n, 'proposition de carte attend', 'propositions de cartes attendent') + ' ton avis.', 'proposals']`.
- [ ] **Step 4 : vérifier en démo.**
  - `npm run build` affiche `✓ built`.
  - Console → Propositions : 2 propositions et le badge « 2 » sur l'onglet.
  - « Intégrer » puis Enregistrer : la carte apparaît dans Cartes avec la pastille « En préparation », la proposition disparaît et le badge passe à 1.
  - « Refuser » puis confirmer : la liste est vide, et le tableau de bord ne signale plus rien.
- [ ] **Step 5 : vérifier sur Supabase** (Review Focus 5, à faire par l'humain après déploiement du patch). Proposer une carte depuis un compte membre, l'intégrer, la publier, puis l'obtenir (code de booster ciblant la carte) : sa photo s'affiche dans la collection du membre.
- [ ] **Step 6 : commit**
```bash
git add src/admin/ProposalsAdmin.tsx src/admin/Cards.tsx src/admin/context.ts src/admin/AdminApp.tsx src/admin/Dashboard.tsx src/styles/admin.css
git commit -m "feat(admin): onglet Propositions, intégration en préparation ou refus"
```
