# Propositions de cartes par les membres

Date : 2026-10-22

## Intention

Les membres du club peuvent proposer de nouvelles cartes. Un membre remplit un formulaire proche de l'éditeur de cartes de la console (photo, nom, etc.). L'administrateur reçoit les propositions dans la console et décide de les intégrer au jeu ou non. Le but est de faire participer les membres à l'enrichissement du jeu, sans perdre le contrôle éditorial : rien n'entre dans le jeu sans passer par l'admin.

## Parcours

### Côté membre (interface de jeu)

- Nouvel onglet « Proposer » dans la barre d'onglets du jeu, après « Classement ».
- Le formulaire reprend les champs de l'éditeur de cartes de la console :
  - photo, obligatoire, avec le même recadrage carré (zoom et position), envoyée en 720 px plus une vignette de 240 px ;
  - nom, obligatoire ;
  - sous-titre (poste ou type) ;
  - description ;
  - numéro de maillot (`stats.numero`) ;
  - jusqu'à 4 statistiques, de 0 à 10 ;
  - rareté, obligatoire, **uniquement parmi les raretés non secrètes** (`rarities.is_secret = false`).
- Champs absents du formulaire : série, numéro dans la série, publication, « dans les boosters ». C'est l'admin qui les décide.
- Un aperçu de la carte (même composant `CardView` que la console) se met à jour pendant la saisie.
- Après l'envoi : message de remerciement, puis formulaire vidé.
- **Le membre voit ses propositions en attente** dans l'onglet : aperçu de chaque carte (photo, nom, rareté) et date d'envoi, avec le compteur « n / 5 ». Une proposition disparaît de cette liste dès que l'admin l'a traitée, qu'elle soit intégrée ou refusée. Le membre ne sait jamais laquelle des deux issues l'a fait disparaître : pas de statut ni de notification. Il ne peut ni modifier ni retirer une proposition en attente.
- **Limite : 5 propositions en attente maximum par membre.** Quand la limite est atteinte, le bouton « Proposer » est désactivé, avec le message : « Tu as déjà 5 propositions en cours d'examen. Tu pourras en proposer d'autres quand l'une d'elles aura été examinée. » La limite est vérifiée avant l'envoi de la photo, puis revérifiée par la base.
- Seuls les comptes actifs peuvent proposer.

### Côté admin (console)

- Nouvel onglet « Propositions » dans la console, avec un compteur des propositions en attente dans l'onglet ou le titre.
- Liste des propositions en attente, de la plus ancienne à la plus récente : aperçu de la carte, nom, rareté, membre qui l'a proposée, date.
- Deux actions par proposition :
  - **Intégrer** : ouvre l'éditeur de cartes habituel, pré-rempli avec la proposition (photo comprise). L'admin choisit la série et le numéro, et peut retoucher les champs texte, les statistiques et la rareté. **La photo reste celle du membre, telle qu'il l'a recadrée** : pas de recadrage ni de remplacement à l'intégration (l'éditeur affiche la photo, verrouillée). Seule la photo de la proposition est envoyée : pas de photo d'origine conservée. À l'enregistrement, la carte est créée **en préparation** (`is_released = false`), et la proposition est retirée de la liste. L'admin publie la carte plus tard, comme n'importe quelle carte.
  - **Refuser** : après confirmation, la proposition et ses photos sont supprimées définitivement.
- Le tableau de bord peut signaler les propositions en attente dans « À vérifier » (lien vers l'onglet).

## Données

- Nouvelle table `public.card_proposals` :
  - `id`, `user_id` (référence `profiles`, suppression en cascade), `created_at` ;
  - les champs de carte proposés : `name`, `subtitle`, `description`, `stats` (jsonb), `rarity_id` (référence `rarities`) ;
  - `image_path` et `thumb_path`, obligatoires.
- Une proposition intégrée ou refusée est **supprimée** de la table. Il n'y a pas de statut et pas d'historique : le membre ne voit jamais rien, et l'admin n'a besoin que de la file d'attente.
- Photos : dans le bucket privé existant `card-images`, sous un préfixe dédié, par exemple `proposals/<user_id>/<slug>-<horodatage>.jpg` et `.thumb.jpg`.
  - Si on intègre : les fichiers sont réutilisés tels quels par la carte créée (chemins copiés dans `cards.image_path` et `thumb_path`), sans les dupliquer. Ils restent sous le préfixe `proposals/`. Le membre perd l'accès en lecture dès que sa proposition est supprimée, et ne les revoit que comme n'importe quelle carte publiée qu'il possède. Si l'admin change plus tard la photo de la carte depuis l'éditeur habituel, l'ancienne est supprimée comme d'habitude.
  - Si on refuse : les fichiers sont supprimés.

## Sécurité (Supabase)

- RLS sur `card_proposals` :
  - un membre actif peut **insérer** une proposition pour lui-même (`user_id = auth.uid()`) et **lire ses propres propositions** ; il ne peut ni les modifier ni les supprimer ;
  - l'admin peut lire et supprimer toutes les propositions.
- La limite de 5 propositions et la règle « rareté non secrète » sont vérifiées **côté base**, par un déclencheur ou par une RPC `propose_card(...)`. Le front ne fait que les afficher : un membre ne doit pas pouvoir les contourner en appelant l'API directement.
- Stockage :
  - un membre actif peut **déposer** des fichiers uniquement sous `proposals/<son uid>/`. Il ne peut ni les remplacer ni les supprimer ;
  - *(choix de Claude)* le dépôt est refusé si son dossier contient déjà 10 fichiers ou plus, soit 5 propositions × 2 fichiers. Cela borne ce qu'il peut stocker en appelant l'API directement ;
  - un membre peut **lire** les photos de ses propositions encore en attente (pour la liste de l'onglet), et c'est tout. L'admin a déjà tous les droits sur le bucket ;
  - *(choix de Claude, limite connue)* les photos d'un envoi refusé par la base, ou d'un compte supprimé, restent orphelines dans le bucket. L'admin peut les retirer depuis Supabase.
- Les photos de proposition ne sont jamais visibles par les autres membres.
- *(choix de Claude)* Les membres actifs peuvent lire `card_subtitles`, pour avoir les mêmes suggestions de sous-titres que la console. Un sous-titre nouveau saisi dans une proposition n'est pas ajouté à la liste, comme aujourd'hui dans la console.
- Un patch SQL rejouable `supabase/patches/2026-10-22-propositions.sql` est ajouté, et `schema.sql` est mis à jour, comme pour les fonctionnalités précédentes.

## Mode démo

Les deux applications de démo ont chacune leur propre stockage local, sans lien entre elles. Une proposition faite dans la démo du jeu n'apparaît donc pas dans la démo de la console. La démo du jeu accepte l'envoi (limite de 5 comprise) ; la démo de la console contient quelques propositions fictives pour montrer l'onglet.

## Objectifs

- Un membre propose une carte complète en moins de deux minutes, depuis son téléphone.
- L'admin traite une proposition en quelques clics, et l'intégration ne demande aucune ressaisie.

## Non-objectifs

- Aucun retour au membre sur la décision : il voit ses propositions en attente, jamais si elles ont été intégrées ou refusées.
- Pas de recadrage ni de remplacement de la photo par l'admin à l'intégration.
- Pas de vote ni de commentaire des autres membres sur les propositions.
- Pas de crédit visible sur la carte intégrée (« proposée par… »).
- Pas de modification d'une proposition après envoi.

## Anti-objectifs

- Une proposition ne doit jamais apparaître dans le jeu (catalogue, boosters, collections) avant l'action explicite de l'admin.
- Un membre ne doit jamais voir les propositions ou les photos des autres.
- Un membre ne doit pas pouvoir dépasser la limite ou choisir une rareté secrète en contournant l'interface.

## Laissé au constructeur

- Mise en commun du formulaire, du recadrage photo et de l'aperçu entre la console et le jeu : extraire un composant partagé plutôt que dupliquer `CardEditor`.
- Forme exacte de la RPC ou du déclencheur, noms des policies.
- Mise en page de l'onglet « Propositions » (tableau ou grille de cartes).
