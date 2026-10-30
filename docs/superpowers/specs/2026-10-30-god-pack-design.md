# God pack

Date : 2026-10-30

## Intention

Introduire le « god pack » : un booster exceptionnel dont **toutes** les cartes appartiennent aux raretés les plus hautes (par défaut Ultra rare, Légendaire, Secrète), sans aucune carte en dessous. C'est un événement rare et marquant pour le joueur, qui le découvre grâce à une animation d'ouverture spéciale.

Deux façons d'en obtenir un :

- **par hasard**, avec une probabilité très faible réglable par l'admin (jusqu'à 1 sur 10 000 et au-delà) ;
- **par code**, l'admin pouvant créer un code booster qui donne un god pack garanti (événement du club, récompense…).

## Objectifs

- God pack possible sur toute ouverture de booster tirée au sort : booster gratuit ou code booster « normal ».
- Probabilité réglable dans la console, sous la forme « 1 sur N ».
- Raretés éligibles au god pack réglables dans la console, rareté par rareté.
- Code booster « god pack garanti ».
- Animation d'ouverture dédiée, sans texte à l'écran.
- Ouverture marquée god pack en base, visible par l'admin.

## Non-objectifs

- Pas d'annonce aux autres membres, pas de notification, pas de classement des god packs.
- Pas de changement du retournement des cartes : les effets de rareté actuels restent tels quels.
- Pas de garantie de cartes nouvelles (doublons possibles, comme dans un booster normal).

## Anti-objectifs (ce qui ferait de la fonctionnalité un échec)

- Un god pack contenant une carte d'une rareté non éligible.
- Un texte « GOD PACK » ou un badge à l'écran : l'animation doit parler seule.
- Un joueur qui devine qu'un booster normal « aurait pu » être un god pack (aucun indice visuel hors god pack).

## Règles de tirage

- **Décision god pack**, au début de `open_booster`, avant le tirage des cartes :
  - code avec « god pack garanti » → god pack ;
  - code « carte précise » (`card_id`) → jamais god pack ;
  - sinon, si la chance est active (N > 0) → god pack avec une probabilité 1/N.
- **Tirage d'une carte dans un god pack** : même logique que `private.draw_card` (rareté selon les poids, puis carte au hasard dans la rareté), mais **limitée aux raretés éligibles**. Les poids habituels sont conservés entre elles : Ultra rare reste plus fréquente que Légendaire, Secrète la plus rare. Une rareté éligible sans carte disponible est ignorée, comme aujourd'hui. Une rareté éligible de poids 0 ne tombe jamais (cohérent avec le tirage normal).
- **Taille** : même nombre de cartes qu'un booster normal (`booster_size`), ou le nombre fixé par le code (`card_count`).
- **Série** : la série choisie par le membre (`p_set_id`) ou celle du code est respectée, comme pour un booster normal.
- **Aucune carte éligible disponible** dans le périmètre (série choisie, cartes publiées, `in_boosters`) :
  - god pack issu du hasard → booster normal, silencieusement ;
  - code god pack garanti → erreur claire (« Aucune carte disponible pour un god pack dans cette série »), **sans consommer le code** (l'erreur annule toute la transaction, comme les erreurs actuelles de `open_booster`).

## Données

Nouveau patch `supabase/patches/2026-10-30-god-pack.sql` (rejouable, même en-tête que les patches existants) et mêmes changements reportés dans `supabase/schema.sql`.

- `game_settings.god_pack_odds int not null default 0 check (god_pack_odds >= 0)` : N dans « 1 sur N ». 0 = désactivé. Par défaut désactivé.
- `rarities.in_god_pack boolean not null default false` : rareté éligible. Le patch coche `ultra_rare`, `legendary`, `secret` (par `code`) ; le seed de `schema.sql` aussi.
- `booster_codes.god_pack boolean not null default false` : god pack garanti. Contrainte : incompatible avec `card_id` (étendre `booster_codes_card_only` ou en ajouter une).
- `booster_openings.god_pack boolean not null default false` : ouverture god pack.
- `open_booster` renvoie au front l'information « god pack » en plus des cartes. Le format exact est au choix du builder (ex. champ ajouté à chaque élément, ou objet `{god_pack, cards}`) ; le front de jeu, le client local/démo de `src/api/game.ts` et le type `DrawnCard`/retour de `openBooster` sont mis à jour en conséquence.
- Les types TS (`Settings`, `Rarity`, `BoosterCode`, ouverture admin) suivent.

## Console d'admin

- **Réglages** : champ « God pack : 1 chance sur N » (entier, 0 = désactivé), avec rappel en clair (« désactivé » / « 1 booster sur 10 000 »).
- **Raretés** : case « God pack » par rareté, dans le tableau existant (`src/admin/Catalog.tsx`).
- **Codes** : case « God pack garanti » à la création d'un code, désactivée si « carte précise » est choisie. Les codes god pack sont repérables dans la liste.
- **Tableau de bord** : dans les dernières ouvertures, une ouverture god pack est signalée (ex. ★ ou libellé « God pack »).
- *Utile, au choix du builder :* le tableau de bord peut avertir si la chance est active mais qu'aucune série in_boosters n'a de carte éligible.

## Animation d'ouverture (option A retenue)

Dans `src/game/Reveal.tsx`, seule la phase « paquet » change, et seulement pour un god pack :

1. **Chute** : identique à un booster normal, rien ne distingue le paquet.
2. **Tremblement** : pendant la charge, le paquet vire progressivement à l'or et se met à briller (halo doré). Charge un peu plus longue qu'un booster normal pour faire monter le suspense.
3. **Rayons** : des rayons dorés tournent derrière le paquet, qui grossit légèrement.
4. **Déchirure** : le paquet éclate dans un flash doré.
5. **Cartes** : déroulement actuel inchangé (pile, retournement une par une, effets de rareté existants, récapitulatif).

Aucun texte ni badge « GOD PACK » à l'écran. Avec `reduceMotion()`, on saute la phase paquet comme aujourd'hui. La maquette validée est dans `.superpowers/brainstorm/352-1793380292/content/godpack-animation-v3.html` (option A) ; elle donne l'esprit, pas les valeurs exactes.

## Page /demo

`src/game/RevealDemo.tsx` (page /demo) permet de simuler un god pack, pour voir l'animation sans attendre la chance réelle.

## Choix faits sans l'auteur (à vérifier)

- La règle « aucun indice » vise l'écran seulement : la chance (`game_settings`), les raretés éligibles et le drapeau `god_pack` des ouvertures restent lisibles par les membres via l'API (devtools), comme le sont déjà les poids des raretés.
- Un code god pack peut aussi fixer une série et un nombre de cartes ; seule la combinaison avec « carte précise » est interdite.

## Laissé au builder

- Format exact du retour d'`open_booster`.
- Durées, couleurs et courbes exactes de l'animation, dans l'esprit de la maquette et du style existant (`src/styles/base.css`).
- Factorisation du tirage (paramètre « god pack » sur `private.draw_card` ou fonction dédiée).
- Libellés exacts dans la console.
