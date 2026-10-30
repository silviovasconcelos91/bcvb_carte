export type Stats = Record<string, number>;

export interface Rarity {
  id: number;
  code: string;
  label: string;
  weight: number;
  is_secret: boolean;
  effect: number; // 1 à 17, voir EFFECTS dans lib/lookup.tsx
  color: string | null; // #rrggbb, sinon couleur par défaut de l'effet
  gems?: number | null; // nombre de losanges (0 à 10), sinon selon l'effet ; absent sur une base pas encore mise à jour
  badge?: string | null; // texte affiché à la place des losanges
  in_god_pack?: boolean; // peut tomber dans un god pack ; absent sur une base pas encore mise à jour
}

// Sous-titre proposé dans l'éditeur de cartes (console uniquement)
export interface Subtitle {
  id: number;
  label: string;
}

export interface CardSet {
  id: number;
  name: string;
  in_boosters: boolean;
}

export interface Card {
  id: number;
  set_id: number;
  number: number | null;
  name: string;
  subtitle: string | null;
  description: string | null;
  image_path: string | null;
  thumb_path: string | null; // vignette 240 px des petits affichages ; null pour les photos envoyées avant les vignettes
  rarity_id: number | null; // null : rareté inconnue (carte mystère d'un échange)
  stats: Stats;
  is_released: boolean;
  in_boosters: boolean;
  masked?: boolean; // carte non possédée : seuls la série, le numéro et la rareté sont connus
}

// Ligne de card_catalog() : les cartes secrètes non possédées en sont absentes
export interface CatalogRow {
  id: number;
  set_id: number;
  number: number | null;
  rarity_id: number | null;
  owned: boolean;
}

// Ligne de leaderboard() : cartes différentes d'un membre dans une série, secrètes comprises
export interface LeaderRow {
  user_id: string;
  username: string;
  distinct_count: number;
}

// Carte proposée par un membre, en attente d'examen par un administrateur
export interface Proposal {
  id: number;
  user_id: string;
  created_at: string;
  name: string;
  subtitle: string | null;
  description: string | null;
  stats: Stats;
  rarity_id: number;
  image_path: string;
  thumb_path: string;
}
export type ProposalInput = Pick<Proposal, 'name' | 'subtitle' | 'description' | 'stats' | 'rarity_id'>;

export type MemberStatus = 'active' | 'pending';

export interface Profile {
  id: string;
  username: string;
  status: MemberStatus; // 'pending' : compte en attente de validation, sans accès au jeu
  last_free_booster_at: string | null;
  created_at?: string;
}

export interface UserCard {
  user_id: string;
  card_id: number;
  quantity: number;
}

export type TradeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'failed' | 'countered';
export type TradeSide = 'offer' | 'request';

export interface TradeItem {
  side: TradeSide;
  card_id: number;
  quantity: number;
}

export interface Trade {
  id: number;
  proposer_id: string;
  recipient_id: string;
  status: TradeStatus;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
  counter_of?: number | null;
  trade_items: TradeItem[];
}

export interface Settings {
  booster_size: number;
  free_booster_cooldown: string;
  free_booster_max?: number; // boosters gratuits cumulables (absent avant le patch : 1)
  god_pack_odds?: number; // god pack : 1 booster sur N, 0 = jamais (absent avant le patch : 0)
}

export interface DrawnCard {
  card_id: number;
  name: string;
  rarity_id: number;
  image_path: string | null;
  is_new: boolean;
  god_pack?: boolean; // booster tiré parmi les raretés in_god_pack (même valeur pour toutes ses cartes)
}

export interface BoosterCode {
  id: number;
  code: string;
  label: string | null;
  set_id: number | null; // limite le tirage à une série (null : séries actives) ; toujours null avec card_id
  card_count: number | null; // nombre de cartes tirées, de 1 à 20 (null : booster complet)
  card_id: number | null; // carte précise offerte ; set_id et card_count sont alors null
  god_pack?: boolean; // god pack garanti (jamais avec card_id)
  max_uses: number | null;
  uses_count: number;
  expires_at: string | null;
  created_at: string;
}

export interface Opening {
  id: number;
  user_id: string;
  code_id: number | null;
  card_ids: number[];
  opened_at: string;
  god_pack?: boolean;
}

export interface CardRef {
  card_id: number;
  quantity: number;
}

// Photo recadrée prête à l'envoi : 720 px pour les grands affichages, vignette 240 px pour les petits
export interface Photo { full: Blob; thumb: Blob }
