import { useEffect, useState } from 'react';
import type { LeaderRow } from '../lib/types';
import { initial } from '../lib/format';
import { useLookup } from '../lib/lookup';
import { useGame } from './context';

const TOP = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

type Ranked = LeaderRow & { rank: number };

// Ex-aequo au même rang, le suivant saute (1, 2, 2, 4) ; les lignes arrivent déjà triées
function rankRows(rows: LeaderRow[]): Ranked[] {
  let rank = 0;
  return rows.map((r, i) => {
    if (!i || rows[i - 1].distinct_count !== r.distinct_count) rank = i + 1;
    return { ...r, rank };
  });
}

export function LeaderboardView() {
  const { api, d, uid } = useGame();
  const L = useLookup();
  const sets = d.sets.filter(s => s.in_boosters);
  const [set, setSet] = useState<number | null>(sets.length ? Math.max(...sets.map(s => s.id)) : null);
  const [rows, setRows] = useState<Ranked[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rechargé aussi après un booster ou un échange (d change)
  useEffect(() => {
    if (set == null) return;
    let alive = true;
    setError(null);
    api.leaderboard(set).then(r => { if (alive) setRows(rankRows(r)); }, e => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [api, set, d]);

  if (set == null) {
    return <div className="empty"><h3>Aucune série en cours</h3><p>Le classement apparaîtra dès qu'une série sera disponible dans les boosters.</p></div>;
  }

  const goal = L.setCount.get(set) ?? 0;
  const pct = (n: number) => (goal ? Math.min(100, Math.round((n / goal) * 100)) : 0);
  const podium = rows?.slice(0, 3) ?? [];
  const list = rows?.slice(3).filter(r => r.rank <= TOP) ?? [];
  const meRow = rows?.find(r => r.user_id === uid);
  const pinned = meRow && meRow.rank > TOP ? meRow : null;

  const line = (r: Ranked) => (
    <li key={r.user_id} className="lb-row" aria-current={r.user_id === uid ? 'true' : undefined}>
      <span className="lb-rank">{r.rank}</span>
      <span className="lb-name">{r.username}</span>
      <span className="lb-bar" aria-hidden="true"><span style={{ width: `${pct(r.distinct_count)}%` }} /></span>
      <span className="lb-count"><b>{r.distinct_count}</b>/{goal}</span>
    </li>
  );

  return (
    <section aria-labelledby="lb-title">
      <h2 className="lb-title" id="lb-title">Classement</h2>
      <p className="lb-lead">Cartes différentes possédées dans la série, doublons non comptés.</p>
      <div className="filters">
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
        <div className="empty"><h3>Personne n'a encore de carte de cette série</h3><p>Ouvre un booster pour prendre la tête du classement.</p></div>
      ) : (
        <>
          <ol className="podium">
            {/* Ordre du classement dans le code, 2e / 1er / 3e à l'écran (CSS) ; hauteur et médaille selon le rang */}
            {podium.map((r, i) => (
              <li key={r.user_id} className={`podium-step at${i + 1} p${r.rank}`} aria-current={r.user_id === uid ? 'true' : undefined}>
                <span className="avatar" aria-hidden="true">{initial(r.username)}</span>
                <span className="podium-name">{r.username}</span>
                <span className="podium-block">
                  <span className="podium-medal" role="img" aria-label={r.rank === 1 ? '1er' : `${r.rank}e`}>{MEDALS[r.rank - 1]}</span>
                  <span className="podium-count">{r.distinct_count}<small>/{goal}</small></span>
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
          {!meRow && <p className="lb-lead lb-me-none">Tu n'as pas encore de carte de cette série.</p>}
        </>
      )}
    </section>
  );
}
