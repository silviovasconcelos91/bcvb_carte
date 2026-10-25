import { Fragment, useState, type KeyboardEvent } from 'react';
import type { Card } from '../lib/types';
import { pad2, percent, plural, sumValues } from '../lib/format';
import { cardName, isSecret, rarClass, rarText, rClass, rarityLabel, useLookup } from '../lib/lookup';
import { CardView, RarityGems } from '../components/visuals';
import { useGame } from './context';

type Show = 'all' | 'owned' | 'missing' | 'dups';
const SHOWS: [Show, string][] = [['all', 'Toutes'], ['owned', 'Possédées'], ['missing', 'Manquantes'], ['dups', 'Doublons']];
type Sort = 'number' | 'rare' | 'common';
const SORTS: [Sort, string][] = [['number', 'Trier par numéro'], ['rare', 'Plus rares d’abord'], ['common', 'Plus communes d’abord']];

export function CollectionView() {
  const { d, openCard, setTab } = useGame();
  const L = useLookup();
  const [set, setSet] = useState('all');
  const [show, setShow] = useState<Show>('all');
  const [rar, setRar] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<Sort>('number');
  const mine = d.mine;
  // Série inactive (hors boosters) : absente de la collection tant que le membre n'en a aucune carte
  const shown = new Set(d.sets.filter(s => s.in_boosters || d.cards.some(c => c.set_id === s.id && mine.get(c.id))).map(s => s.id));
  const cards = d.cards.filter(c => shown.has(c.set_id));
  // Les cartes secrètes possédées comptent dans le score, jamais dans le total
  const distinct = cards.filter(c => mine.get(c.id)).length;
  const goal = cards.filter(c => !isSecret(L, c)).length;
  const total = sumValues(mine);
  const dups = [...mine.values()].reduce((a, q) => a + q - 1, 0);
  const pct = percent(distinct, goal);
  // Avancement de chaque série affichée, montré à la place du total dès qu'il y a plusieurs séries
  const bySet = d.sets.filter(s => shown.has(s.id) && cards.some(c => c.set_id === s.id)).map(s => {
    const inSet = cards.filter(c => c.set_id === s.id);
    const n = inSet.filter(c => mine.get(c.id)).length, of = inSet.filter(c => !isSecret(L, c)).length;
    return { s, n, of, pct: percent(n, of) };
  });

  let list = cards.filter(c => set === 'all' || String(c.set_id) === set);
  if (rar.size) list = list.filter(c => c.rarity_id != null && rar.has(c.rarity_id));
  if (show === 'owned') list = list.filter(c => mine.get(c.id));
  if (show === 'missing') list = list.filter(c => !mine.get(c.id));
  if (show === 'dups') list = list.filter(c => (mine.get(c.id) ?? 0) > 1);
  // Tri par rareté à l'intérieur de chaque série : moins une rareté tombe souvent, plus elle est rare.
  // Les cartes de rareté inconnue restent à la fin, le numéro départage les égalités.
  if (sort !== 'number') {
    const rank = (c: Card) => (c.rarity_id != null ? L.rarityById.get(c.rarity_id)?.weight ?? Infinity : Infinity);
    const dir = sort === 'rare' ? 1 : -1;
    const byRarity = (ra: number, rb: number) => (ra === rb ? 0 : !isFinite(ra) ? 1 : !isFinite(rb) ? -1 : (ra - rb) * dir);
    list = [...list].sort((a, b) => a.set_id - b.set_id || byRarity(rank(a), rank(b)) || (a.number ?? 0) - (b.number ?? 0));
  }
  const multi = new Set(list.map(c => c.set_id)).size > 1;

  const toggleRar = (id: number) => setRar(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <section aria-labelledby="col-title">
      {bySet.length > 1 ? (
        <div>
          <h2 className="score-label" id="col-title">Cartes différentes dans ta collection, par série</h2>
          {/* Une série par tuile ; un clic filtre le classeur sur cette série (second clic : toutes les séries) */}
          <div className="score-sets">
            {bySet.map(({ s, n, of, pct: p }) => (
              <button key={s.id} className="score-set" aria-pressed={set === String(s.id)} onClick={() => setSet(set === String(s.id) ? 'all' : String(s.id))}>
                <span className="score-set-name">{s.name}</span>
                <span className="score-line"><span className="score-num">{n}</span><span className="score-total">/{of}</span></span>
                <span className="bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={`${s.name} complète à ${p} %`}><span style={{ width: `${p}%` }} /></span>
              </button>
            ))}
          </div>
          <p className="score-sub">{plural(total, 'carte', 'cartes')} au total{dups ? `, dont ${plural(dups, 'double', 'doubles')} à échanger` : ''}.</p>
        </div>
      ) : (
        <div className="score">
          <p className="score-line"><span className="score-num">{distinct}</span><span className="score-total">/{goal}</span></p>
          <h2 className="score-label" id="col-title">cartes différentes<br />dans ta collection</h2>
          <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Collection complète à ${pct} %`}><span style={{ width: `${pct}%` }} /></div>
          <p className="score-sub">{plural(total, 'carte', 'cartes')} au total{dups ? `, dont ${plural(dups, 'double', 'doubles')} à échanger` : ''}.</p>
        </div>
      )}
      <div className="filters">
        <span className="select-wrap">
          <select className="select" value={set} onChange={e => setSet(e.target.value)} aria-label="Série">
            <option value="all">Toutes les séries</option>
            {d.sets.filter(s => cards.some(c => c.set_id === s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </span>
        <span className="select-wrap">
          <select className="select" value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Trier">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </span>
        <div className="seg" role="group" aria-label="Afficher">
          {SHOWS.map(([v, l]) => <button key={v} aria-pressed={show === v} onClick={() => setShow(v)}>{l}</button>)}
        </div>
        <div className="rchips" role="group" aria-label="Rareté">
          {/* Rareté secrète : visible dans le filtre seulement une fois une de ses cartes obtenue */}
          {d.rarities.filter(r => !r.is_secret || cards.some(c => c.rarity_id === r.id && mine.get(c.id))).map(r => <button key={r.id} className={`rchip ${rarClass(L, r.id)}`} aria-pressed={rar.has(r.id)} onClick={() => toggleRar(r.id)}><i />{r.label}</button>)}
        </div>
      </div>
      {!total ? (
        <div className="empty"><h3>Ta collection est vide</h3><p>Ouvre ton premier booster : les cartes obtenues apparaîtront ici.</p><button className="btn primary" onClick={() => setTab('booster')}>Aller au booster</button></div>
      ) : !list.length ? (
        <div className="empty"><h3>Aucune carte avec ces filtres</h3><p>Change de série, de rareté ou d'affichage pour voir d'autres cartes.</p>
          <button className="btn" onClick={() => { setSet('all'); setShow('all'); setRar(new Set()); }}>Retirer les filtres</button></div>
      ) : (
        <div className="binder">
          {list.map((c, i) => (
            <Fragment key={c.id}>
              {multi && (i === 0 || list[i - 1].set_id !== c.set_id) && setHeader(c.set_id)}
              {pocket(c)}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );

  function setHeader(setId: number) {
    const inSet = d.cards.filter(x => x.set_id === setId);
    return <h3 className="binder-set">{d.lookup.setById.get(setId)?.name}<span>{inSet.filter(x => mine.get(x.id)).length}/{inSet.filter(x => !isSecret(L, x)).length}</span></h3>;
  }
  function pocket(card: Card) {
    const q = mine.get(card.id) ?? 0;
    const open = () => openCard(card.id);
    const keys = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    if (q) {
      return (
        <div className="pocket" role="button" tabIndex={0} onClick={open} onKeyDown={keys}
          aria-label={`${card.name}, ${rarityLabel(L, card.rarity_id)}, ${plural(q, 'exemplaire', 'exemplaires')}`}>
          <CardView card={card} qty={q} />
        </div>
      );
    }
    // Carte non possédée : numéro et rareté seulement
    return (
      <div className={`pocket ${rClass(L, card)}`} role="button" tabIndex={0} onClick={open} onKeyDown={keys}
        aria-label={`${cardName(card)}, ${rarText(L, card).toLowerCase()}, pas dans ta collection`}>
        <div className="slot">
          <span className="slot-num">{pad2(card.number)}</span>
          <span className="slot-name">{card.rarity_id ? rarText(L, card) : ''}</span>
          {card.rarity_id ? <span className="gems"><RarityGems id={card.rarity_id} /></span> : <span className="slot-q" aria-hidden="true">?</span>}
        </div>
      </div>
    );
  }
}
