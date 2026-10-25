import { useState } from 'react';
import type { Card, CardRef } from '../lib/types';
import { errMsg, plural, sumValues } from '../lib/format';
import { cardName, rClass, rarText, useLookup } from '../lib/lookup';
import { Avatar, MiniArt } from '../components/visuals';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { nameOf, useGame } from './context';

export interface ComposerOpts {
  to?: string;
  want?: [number, number][];
  give?: [number, number][];
  counter?: number; // id de l'échange reçu auquel on répond
}

export function Composer({ opts, onClose }: { opts: ComposerOpts; onClose: () => void }) {
  const { api, d, uid, refresh, setTab } = useGame();
  const L = useLookup();
  const toast = useToast();
  const [to, setTo] = useState<string | null>(opts.to ?? null);
  const [give, setGive] = useState<Map<number, number>>(new Map(opts.give ?? []));
  const [want, setWant] = useState<Map<number, number>>(new Map(opts.want ?? []));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Onglet de série : au départ, celle de la première carte proposée ou demandée
  const [setTabId, setSetTabId] = useState<number | null>(() => {
    const first = [...(opts.want ?? []), ...(opts.give ?? [])][0];
    return first ? d.cardById.get(first[0])?.set_id ?? null : null;
  });

  const g = sumValues(give), w = sumValues(want);
  const toName = to ? nameOf(d, to) : '';

  // Un onglet par série présente chez l'un ou l'autre ; les cartes choisies restent retenues d'un onglet à l'autre
  const held = new Set([...(d.mine.keys()), ...((to && d.owned.get(to)?.keys()) || [])].map(cid => d.cardById.get(cid)?.set_id));
  const tabSets = d.sets.filter(s => held.has(s.id));
  const activeSet = tabSets.find(s => s.id === setTabId) ?? tabSets[0];
  const bySets = tabSets.length > 1;
  const chosenIn = (setId: number) => [...give, ...want].reduce((a, [cid, n]) => a + (d.cardById.get(cid)?.set_id === setId ? n : 0), 0);

  function step(kind: 'give' | 'want', id: number, delta: number) {
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

  const summary = !g && !w ? 'Choisis au moins une carte.'
    : !w ? `Tu donnes ${plural(g, 'carte', 'cartes')} sans rien demander en retour.`
    : !g ? `Tu demandes ${plural(w, 'carte', 'cartes')} sans rien donner : ${toName} décidera.`
    : `Tu donnes ${plural(g, 'carte', 'cartes')} et tu demandes ${plural(w, 'carte', 'cartes')}.`;

  function pickList(owner: string, sel: Map<number, number>, kind: 'give' | 'want') {
    const inv = d.owned.get(owner) ?? new Map<number, number>();
    const missing = (id: number) => !d.mine.get(id);
    // Plus le poids au tirage est faible, plus la carte est rare
    const rank = (c: Card) => (c.rarity_id != null ? L.rarityById.get(c.rarity_id)?.weight ?? 0 : 0);
    const theirs = to ? d.owned.get(to) : undefined;
    const theyMiss = (id: number) => !theirs?.get(id);
    const rows = [...inv.entries()].map(([cid, q]) => ({ c: d.cardById.get(cid)!, q })).filter(x => x.c && (!bySets || x.c.set_id === activeSet.id));
    rows.sort(kind === 'give'
      ? (a, b) => Number(theyMiss(b.c.id)) - Number(theyMiss(a.c.id)) || Number(b.q > 1) - Number(a.q > 1) || rank(b.c) - rank(a.c) || cardName(a.c).localeCompare(cardName(b.c), 'fr')
      : (a, b) => Number(missing(b.c.id)) - Number(missing(a.c.id)) || rank(a.c) - rank(b.c) || cardName(a.c).localeCompare(cardName(b.c), 'fr'));
    if (!rows.length && bySets) {
      return <p className="pick-empty muted">{kind === 'give' ? "Tu n'as pas de carte de cette série." : `${nameOf(d, owner)} n'a pas de carte de cette série.`}</p>;
    }
    if (!rows.length) {
      return <p className="pick-empty muted">{kind === 'give' ? "Tu n'as pas encore de carte à donner. Tu peux quand même en demander une." : "Ce membre n'a pas encore de carte."}</p>;
    }
    const holder = kind === 'give' ? 'tu en as' : `${nameOf(d, owner)} en a`;
    return (
      <ul className="pick-cards">
        {rows.map(({ c, q }) => {
          const n = sel.get(c.id) ?? 0;
          return (
            <li key={c.id} className={`pick-row ${rClass(L, c)}${n ? ' is-on' : ''}`}>
              <span className="chip-art"><MiniArt card={c} /></span>
              <span className="pick-main">
                <span className="pick-name">{cardName(c)}{kind === 'give' ? <>{theyMiss(c.id) && <span className="tag want">lui manque</span>}{q > 1 && <span className="tag">double</span>}</> : (missing(c.id) && <span className="tag want">te manque</span>)}</span>
                <span className="pick-meta">{rarText(L, c)}, {holder} {q}</span>
              </span>
              <span className="stepper">
                <button className="step" disabled={!n} onClick={() => step(kind, c.id, -1)} aria-label={`Retirer un exemplaire de ${cardName(c)}`}>−</button>
                <span className="step-n">{n}</span>
                <button className="step" disabled={n >= q} onClick={() => step(kind, c.id, 1)} aria-label={`Ajouter un exemplaire de ${cardName(c)}`}>+</button>
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Modal title={opts.counter ? 'Contre-proposition' : 'Nouvel échange'} onClose={onClose} wide
      footer={to ? <><p className="composer-sum">{summary}</p><button className="btn primary" disabled={!(g + w) || busy} onClick={() => void send()}>{opts.counter ? 'Envoyer la contre-proposition' : 'Envoyer la proposition'}</button></> : undefined}>
      {!to ? (
        <>
          <p className="muted">Avec qui veux-tu échanger&nbsp;?</p>
          <ul className="pick-list">
            {d.profiles.filter(p => p.id !== uid).map(p => {
              const theirs = d.owned.get(p.id) ?? new Map<number, number>();
              const useful = [...theirs.keys()].filter(cid => !d.mine.get(cid)).length;
              const offer = [...d.mine.keys()].filter(cid => d.mine.get(cid) && !theirs.get(cid)).length;
              return (
                <li key={p.id}>
                  <button className="pick" onClick={() => { setTo(p.id); setGive(new Map()); setWant(new Map()); }}>
                    <Avatar name={p.username} />
                    <span className="pick-main"><span className="pick-name">{p.username}</span>
                      <span className="pick-meta">{plural(sumValues(theirs), 'carte', 'cartes')}{useful ? `, dont ${useful} qui te ${useful > 1 ? 'manquent' : 'manque'}` : ''}
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
          {bySets && (
            <div className="seg composer-sets" role="group" aria-label="Série">
              {tabSets.map(s => {
                const n = chosenIn(s.id);
                return (
                  <button key={s.id} aria-pressed={s.id === activeSet.id} onClick={() => setSetTabId(s.id)}>
                    {s.name}{n > 0 && <span className="seg-n">{n}<span className="sr-only"> {n > 1 ? 'cartes choisies' : 'carte choisie'}</span></span>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="composer-cols">
            <section><h3 className="h3">Je donne</h3>{pickList(uid, give, 'give')}</section>
            <section><h3 className="h3">Je demande à {toName}</h3>{pickList(to, want, 'want')}</section>
          </div>
          <label className="msg-label" htmlFor="trade-msg">Message (facultatif)</label>
          <textarea id="trade-msg" className="input textarea" maxLength={280} value={message} onChange={e => setMessage(e.target.value)} placeholder="Ex. Il me manque celle-là pour finir la série" />
        </>
      )}
    </Modal>
  );
}
