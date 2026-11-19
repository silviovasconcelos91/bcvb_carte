import { useEffect, useState } from 'react';
import type { LeaderRow } from '../lib/types';
import { errMsg, percent } from '../lib/format';
import { Avatar } from '../components/visuals';
import { useLookup } from '../lib/lookup';
import { useGame } from './context';

const TOP = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

// Catégorie : cartes différentes possédées, ou boosters ouverts (rang seul, le nombre n'est jamais montré)
type Kind = 'cards' | 'boosters';
type Ranked = { user_id: string; username: string; rank: number; count?: number };

// Ex-aequo au même rang, le suivant saute (1, 2, 2, 4) ; les lignes arrivent déjà triées
function rankRows(rows: LeaderRow[]): Ranked[] {
  let rank = 0;
  return rows.map((r, i) => {
    if (!i || rows[i - 1].distinct_count !== r.distinct_count) rank = i + 1;
    return { user_id: r.user_id, username: r.username, rank, count: r.distinct_count };
  });
}

export function LeaderboardView() {
  const { api, d, uid } = useGame();
  const L = useLookup();
  const sets = d.sets.filter(s => s.in_boosters);
  const [set, setSet] = useState<number | null>(sets.length ? Math.max(...sets.map(s => s.id)) : null);
  const [kind, setKind] = useState<Kind>('cards');
  const [rows, setRows] = useState<Ranked[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rechargé aussi après un booster ou un échange (d change)
  useEffect(() => {
    if (set == null) return;
    let alive = true;
    setError(null);
    const load = kind === 'cards' ? api.leaderboard(set).then(rankRows) : api.boosterLeaderboard(set);
    load.then(r => { if (alive) setRows(r); }, e => { if (alive) setError(errMsg(e)); });
    return () => { alive = false; };
  }, [api, set, kind, d]);

  if (set == null) {
    return <div className="empty"><h3>Aucune série en cours</h3><p>Le classement apparaîtra dès qu'une série sera disponible dans les boosters.</p></div>;
  }

  const cards = kind === 'cards';
  const goal = L.setCount.get(set) ?? 0;
  const podium = rows?.slice(0, 3) ?? [];
  const list = rows?.slice(3).filter(r => r.rank <= TOP) ?? [];
  const meRow = rows?.find(r => r.user_id === uid);
  const pinned = meRow && meRow.rank > TOP ? meRow : null;

  const line = (r: Ranked) => (
    <li key={r.user_id} className={`lb-row${cards ? '' : ' no-count'}`} aria-current={r.user_id === uid ? 'true' : undefined}>
      <span className="lb-rank">{r.rank}</span>
      <span className="lb-name">{r.username}</span>
      {cards && <>
        <span className="lb-bar" aria-hidden="true"><span style={{ width: `${percent(r.count ?? 0, goal)}%` }} /></span>
        <span className="lb-count"><b>{r.count}</b>/{goal}</span>
      </>}
    </li>
  );
  const pick = (k: Kind) => { if (k !== kind) { setRows(null); setKind(k); } };

  return (
    <section aria-labelledby="lb-title">
      <h2 className="lb-title" id="lb-title">Classement</h2>
      <p className="lb-lead">{cards ? 'Cartes différentes possédées dans la série, doublons non comptés.' : 'Boosters ouverts contenant des cartes de la série.'}</p>
      <div className="filters">
        <div className="seg" role="group" aria-label="Catégorie">
          <button aria-pressed={cards} onClick={() => pick('cards')}>Cartes</button>
          <button aria-pressed={!cards} onClick={() => pick('boosters')}>Boosters ouverts</button>
        </div>
        <span className="select-wrap">
          <select className="select" value={set} onChange={e => { setRows(null); setSet(+e.target.value); }} aria-label="Série">
            {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </span>
      </div>
      {error ? (
        <div className="empty"><h3>Impossible de charger le classement</h3><p>{error}</p></div>
      ) : !rows ? (
        <p className="lb-lead">Chargement…</p>
      ) : !rows.length ? (
        <div className="empty">
          <h3>{cards ? "Personne n'a encore de carte de cette série" : "Personne n'a encore ouvert de booster de cette série"}</h3>
          <p>Ouvre un booster pour prendre la tête du classement.</p>
        </div>
      ) : (
        <>
          <ol className="podium">
            {/* Ordre du classement dans le code, 2e / 1er / 3e à l'écran (CSS) ; hauteur et médaille selon le rang */}
            {podium.map((r, i) => (
              <li key={r.user_id} className={`podium-step at${i + 1} p${r.rank}`} aria-current={r.user_id === uid ? 'true' : undefined}>
                <Avatar name={r.username} />
                <span className="podium-name">{r.username}</span>
                <span className="podium-block">
                  <span className="podium-medal" role="img" aria-label={r.rank === 1 ? '1er' : `${r.rank}e`}>{MEDALS[r.rank - 1]}</span>
                  {cards && <span className="podium-count">{r.count}<small>/{goal}</small></span>}
                </span>
              </li>
            ))}
          </ol>
          {list.length > 0 && <ol className="lb-list">{list.map(line)}</ol>}
          {pinned && (
            <>
              <p className="lb-gap" aria-hidden="true">⋯</p>
              <ol className="lb-list">{line(pinned)}</ol>
            </>
          )}
          {!meRow && <p className="lb-lead lb-me-none">{cards ? "Tu n'as pas encore de carte de cette série." : "Tu n'as pas encore ouvert de booster de cette série."}</p>}
        </>
      )}
    </section>
  );
}
