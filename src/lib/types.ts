export type Stats = Record<string, number>;

export interface Rarity {
  id: number;
  code: string;
  label: string;
  weight: number;
  is_secret: boolean;
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

export type TradeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'failed';
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
  trade_items: TradeItem[];
}

export interface Settings {
  booster_size: number;
  free_booster_cooldown: string;
}

export interface DrawnCard {
  card_id: number;
  name: string;
  rarity_id: number;
  image_path: string | null;
  is_new: boolean;
}

export interface BoosterCode {
  id: number;
  code: string;
  label: string | null;
  set_id: number | null; // limite le tirage à une série (null : séries actives) ; toujours null avec card_id
  card_count: number | null; // nombre de cartes tirées, de 1 à 20 (null : booster complet)
  card_id: number | null; // carte précise offerte ; set_id et card_count sont alors null
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
}

export interface CardRef {
  card_id: number;
  quantity: number;
}
