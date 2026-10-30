import { useState } from 'react';
import type { Card, CardRef } from '../lib/types';
import { errMsg, listFr, plural, stripAccents, sumValues } from '../lib/format';
import { cardName, rClass, rarText, useLookup } from '../lib/lookup';
import { Avatar, CardBack, CardView, MiniArt } from '../components/visuals';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { nameOf, useGame } from './context';

export interface ComposerOpts {
  to?: string;
  want?: [number, number][];
  give?: [number, number][];
  counter?: number; // id de l'échange reçu auquel on répond
}

type Side = 'give' | 'want';
type Filter = 'double' | 'missing' | 'all';

const fold = (s: string) => stripAccents(s).toLowerCase();

export function Composer({ opts, onClose }: { opts: ComposerOpts; onClose: () => void }) {
  const { api, d, uid, refresh, setTab } = useGame();
  const L = useLookup();
  const toast = useToast();
  const [to, setTo] = useState<string | null>(opts.to ?? null);
  const [give, setGive] = useState<Map<number, number>>(new Map(opts.give ?? []));
  const [want, setWant] = useState<Map<number, number>>(new Map(opts.want ?? []));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<Side>(opts.want?.length && !opts.give?.length ? 'want' : 'give');
  const [query, setQuery] = useState('');
  // Filtre rapide par côté ; null = choix automatique (doubles ou cartes manquantes s'il y en a)
  const [filters, setFilters] = useState<Record<Side, Filter | null>>({ give: opts.give?.length ? 'all' : null, want: opts.want?.length ? 'all' : null });
  // Série affichée : null = toutes les séries
  const [setId, setSetId] = useState<number | null>(null);

  const g = sumValues(give), w = sumValues(want);
  const toName = to ? nameOf(d, to) : '';
  const mine = d.mine;
  const theirs = (to && d.owned.get(to)) || new Map<number, number>();

  // Séries présentes chez l'un ou l'autre ; les cartes choisies restent retenues d'une série à l'autre
  const held = new Set([...mine.keys(), ...theirs.keys()].map(cid => d.cardById.get(cid)?.set_id));
  const tabSets = d.sets.filter(s => held.has(s.id));
  const activeSet = tabSets.find(s => s.id === setId) ?? null;

  function toggle(kind: Side, id: number) {
    const setter = kind === 'give' ? setGive : setWant;
    setter(prev => {
      const next = new Map(prev);
      if (next.get(id)) next.delete(id); else next.set(id, 1);
      return next;
    });
  }
  function step(kind: Side, id: number, delta: number) {
    const setter = kind === 'give' ? setGive : setWant;
    setter(prev => {
      const next = new Map(prev);
      const n = Math.max(0, (next.get(id) ?? 0) + delta);
      if (n) next.set(id, n); else next.delete(id);
      return next;
    });
  }
  async function send() {
    if (!to || !(g + w)) return;
    const list = (m: Map<number, number>): CardRef[] => [...m].filter(([, n]) => n > 0).map(([card_id, quantity]) => ({ card_id, quantity }));
    setBusy(true);
    try {
      if (opts.counter) await api.counterTrade(opts.counter, list(give), list(want), message.trim() || null);
      else await api.createTrade(to, list(give), list(want), message.trim() || null);
      onClose();
      setTab('trades');
      await refresh();
      toast(opts.counter ? `Contre-proposition envoyée à ${toName}` : `Proposition envoyée à ${toName}`);
    } catch (e) {
      toast(errMsg(e), true);
      setBusy(false);
    }
  }

  // Cartes dont on donnerait le dernier exemplaire
  const lastOnes = [...give].filter(([cid, n]) => n >= (mine.get(cid) ?? 0)).map(([cid]) => d.cardById.get(cid)).filter((c): c is Card => !!c);

  const summary = !g && !w ? 'Touche une carte pour l’ajouter à l’échange.'
    : !w ? `Tu donnes ${plural(g, 'carte', 'cartes')} sans rien demander en retour.`
    : !g ? `Tu demandes ${plural(w, 'carte', 'cartes')} sans rien donner : ${toName} décidera.`
    : `Tu donnes ${plural(g, 'carte', 'cartes')} et tu demandes ${plural(w, 'carte', 'cartes')}.`;

  function grid(kind: Side) {
    const owner = kind === 'give' ? uid : to!;
    const inv = kind === 'give' ? mine : theirs;
    const sel = kind === 'give' ? give : want;
    const theyMiss = (id: number) => !theirs.get(id);
    const iMiss = (id: number) => !mine.get(id);
    // Plus le poids au tirage est faible, plus la carte est rare
    const rank = (c: Card) => (c.rarity_id != null ? L.rarityById.get(c.rarity_id)?.weight ?? 0 : 0);
    const all = [...inv.entries()].map(([cid, q]) => ({ c: d.cardById.get(cid)!, q })).filter(x => x.c && (!activeSet || x.c.set_id === activeSet.id));
    const hasDouble = all.some(x => x.q > 1), hasMissing = all.some(x => (kind === 'give' ? theyMiss : iMiss)(x.c.id));
    const filter = filters[kind] ?? (kind === 'give' ? (hasDouble ? 'double' : 'all') : (hasMissing ? 'missing' : 'all'));
    const needle = fold(query.trim());
    const rows = all.filter(({ c, q: n }) => (filter === 'all' || (filter === 'double' ? n > 1 : (kind === 'give' ? theyMiss : iMiss)(c.id)) || sel.get(c.id))
      && (!needle || fold(cardName(c)).includes(needle)));
    rows.sort(kind === 'give'
      ? (a, b) => Number(theyMiss(b.c.id)) - Number(theyMiss(a.c.id)) || Number(b.q > 1) - Number(a.q > 1) || rank(b.c) - rank(a.c) || cardName(a.c).localeCompare(cardName(b.c), 'fr')
      : (a, b) => Number(iMiss(b.c.id)) - Number(iMiss(a.c.id)) || rank(a.c) - rank(b.c) || cardName(a.c).localeCompare(cardName(b.c), 'fr'));

    const setF = (f: Filter) => setFilters(prev => ({ ...prev, [kind]: f }));
    const chip = (f: Filter, label: string) => <button key={f} className="fchip" aria-pressed={filter === f} onClick={() => setF(f)}>{label}</button>;
    const filterRow = (
      <div className="pick-filters" role="group" aria-label="Filtres">
        {kind === 'give' ? <>{chip('double', 'Doubles')}{chip('missing', 'Lui manque')}</> : chip('missing', 'Te manque')}
        {chip('all', 'Toutes')}
        {tabSets.length > 1 && <>
          <span className="fsep" aria-hidden="true" />
          <button className="fchip" aria-pressed={!activeSet} onClick={() => setSetId(null)}>Toutes les séries</button>
          {tabSets.map(s => <button key={s.id} className="fchip" aria-pressed={activeSet?.id === s.id} onClick={() => setSetId(s.id)}>{s.name}</button>)}
        </>}
      </div>
    );

    let body;
    if (!inv.size) {
      body = <p className="pick-empty muted">{kind === 'give' ? "Tu n'as pas encore de carte à donner. Tu peux quand même en demander une." : "Ce membre n'a pas encore de carte."}</p>;
    } else if (!rows.length) {
      body = <p className="pick-empty muted">Aucune carte avec ces filtres.{(filter !== 'all' || needle) && <> <button className="link-btn" onClick={() => { setF('all'); setQuery(''); }}>Tout afficher</button></>}</p>;
    } else {
      body = (
        <ul className="pick-grid">
          {rows.map(({ c, q: owned }) => {
            const n = sel.get(c.id) ?? 0;
            const last = kind === 'give' && owned === 1;
            const tag = kind === 'give' ? (theyMiss(c.id) && 'lui manque') : (iMiss(c.id) && 'te manque');
            const holder = kind === 'give' ? (last ? 'ta dernière' : `tu en as ${owned}`) : `${nameOf(d, owner)} en a ${owned}`;
            return (
              <li key={c.id} className={`pick-tile${n ? ' is-on' : ''}${n && n >= owned && kind === 'give' ? ' is-last' : ''}`}>
                <div className="pick-wrap">
                  <button className="pick-card" aria-pressed={n > 0} onClick={() => toggle(kind, c.id)}
                    aria-label={`${cardName(c)}, ${rarText(L, c)}, ${holder}${tag ? `, ${tag}` : ''}`}>
                    {c.masked ? <CardBack /> : <CardView card={c} />}
                  </button>
                  <span className={`own${last ? ' last' : ''}`} aria-hidden="true">{last ? 'dernière' : `×${owned}`}</span>
                  {n > 0 && owned > 1 && (
                    <span className="stepper pick-step">
                      <button className="step" onClick={() => step(kind, c.id, -1)} aria-label={`Retirer un exemplaire de ${cardName(c)}`}>−</button>
                      <span className="step-n">{n}</span>
                      <button className="step" disabled={n >= owned} onClick={() => step(kind, c.id, 1)} aria-label={`Ajouter un exemplaire de ${cardName(c)}`}>+</button>
                    </span>
                  )}
                  {n > 0 && owned === 1 && <span className="pick-check" aria-hidden="true">✓</span>}
                </div>
                {(tag || c.masked) && <p className="pick-cap" aria-hidden="true">{c.masked && <span className="pick-cap-name">{cardName(c)} · {rarText(L, c)}</span>}{tag}</p>}
              </li>
            );
          })}
        </ul>
      );
    }
    return <>{filterRow}{body}</>;
  }

  // Récap : toucher une carte la retire de l'échange
  const recap = (kind: Side) => {
    const sel = kind === 'give' ? give : want;
    if (!sel.size) return <span className="recap-none">Rien</span>;
    return [...sel].map(([cid, n]) => {
      const c = d.cardById.get(cid);
      if (!c) return null;
      const last = kind === 'give' && n >= (mine.get(cid) ?? 0);
      return (
        <button key={cid} className={`rc-chip ${rClass(L, c)}${last ? ' warn' : ''}`} onClick={() => toggle(kind, cid)} aria-label={`Retirer ${cardName(c)} de l'échange`}>
          <span className="chip-art"><MiniArt card={c} /></span>
          <span>{last && '⚠ '}{cardName(c)}{n > 1 ? ` ×${n}` : ''}</span>
        </button>
      );
    });
  };

  const footer = to ? (
    <div className="composer-recap">
      <div className="rc-sides">
        <div className="rc-side"><span className="swap-label">Tu donnes</span><div className="rc-list">{recap('give')}</div></div>
        <span className="rc-swap" aria-hidden="true">⇄</span>
        <div className="rc-side"><span className="swap-label">Tu reçois</span><div className="rc-list">{recap('want')}</div></div>
      </div>
      {lastOnes.length > 0 && <p className="rc-warn">⚠ Tu donnerais {lastOnes.length > 1 ? 'tes derniers exemplaires de' : 'ton dernier exemplaire de'} {listFr(lastOnes.map(cardName))}.</p>}
      <div className="rc-foot">
        <p className="composer-sum">{summary}</p>
        <button className="btn primary" disabled={!(g + w) || busy} onClick={() => void send()}>{opts.counter ? 'Envoyer la contre-proposition' : 'Envoyer la proposition'}</button>
      </div>
    </div>
  ) : undefined;

  return (
    <Modal title={opts.counter ? 'Contre-proposition' : 'Nouvel échange'} onClose={onClose} wide footer={footer}>
      {!to ? (
        <>
          <p className="muted">Avec qui veux-tu échanger&nbsp;?</p>
          <ul className="pick-list">
            {d.profiles.filter(p => p.id !== uid).map(p => {
              const inv = d.owned.get(p.id) ?? new Map<number, number>();
              const useful = [...inv.keys()].filter(cid => !mine.get(cid)).length;
              const offer = [...mine.keys()].filter(cid => mine.get(cid) && !inv.get(cid)).length;
              return (
                <li key={p.id}>
                  <button className="pick" onClick={() => { setTo(p.id); setGive(new Map()); setWant(new Map()); }}>
                    <Avatar name={p.username} />
                    <span className="pick-main"><span className="pick-name">{p.username}</span>
                      <span className="pick-meta">{plural(sumValues(inv), 'carte', 'cartes')}{useful ? `, dont ${useful} qui te ${useful > 1 ? 'manquent' : 'manque'}` : ''}
                        {offer ? ` · tu en as ${offer} qui lui ${offer > 1 ? 'manquent' : 'manque'}` : ''}</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <div className="composer-to">
            <Avatar name={toName} small />
            <span>{opts.counter ? 'Contre-proposition à' : 'Échange avec'} <strong>{toName}</strong></span>
            {!opts.counter && <button className="btn small ghost" onClick={() => setTo(null)}>Changer de membre</button>}
          </div>
          <div className="composer-bar">
            <div className="seg" role="group" aria-label="Côté de l'échange">
              <button aria-pressed={side === 'give'} onClick={() => setSide('give')}>Je donne{g > 0 && <span className="seg-n">{g}</span>}</button>
              <button aria-pressed={side === 'want'} onClick={() => setSide('want')}>Je demande{w > 0 && <span className="seg-n">{w}</span>}</button>
            </div>
            <input className="input composer-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher une carte…" aria-label="Rechercher une carte" />
          </div>
          {grid(side)}
          <label className="msg-label" htmlFor="trade-msg">Message (facultatif)</label>
          <textarea id="trade-msg" className="input textarea" maxLength={280} value={message} onChange={e => setMessage(e.target.value)} placeholder="Ex. Il me manque celle-là pour finir la série" />
        </>
      )}
    </Modal>
  );
}
