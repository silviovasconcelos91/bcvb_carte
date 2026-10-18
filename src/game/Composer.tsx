import { useState } from 'react';
import type { CardRef } from '../lib/types';
import { initial, plural, sumValues } from '../lib/format';
import { cardName, rClass, rarText, useLookup } from '../lib/lookup';
import { MiniArt } from '../components/visuals';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { nameOf, useGame } from './context';

export interface ComposerOpts {
  to?: string;
  want?: [number, number][];
}

export function Composer({ opts, onClose }: { opts: ComposerOpts; onClose: () => void }) {
  const { api, d, uid, refresh, setTab } = useGame();
  const L = useLookup();
  const toast = useToast();
  const [to, setTo] = useState<string | null>(opts.to ?? null);
  const [give, setGive] = useState<Map<number, number>>(new Map());
  const [want, setWant] = useState<Map<number, number>>(new Map(opts.want ?? []));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const g = sumValues(give), w = sumValues(want);
  const toName = to ? nameOf(d, to) : '';

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
      await api.createTrade(to, list(give), list(want), message.trim() || null);
      onClose();
      setTab('trades');
      await refresh();
      toast(`Proposition envoyée à ${toName}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
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
    const theirs = to ? d.owned.get(to) : undefined;
    const theyMiss = (id: number) => !theirs?.get(id);
    const rows = [...inv.entries()].map(([cid, q]) => ({ c: d.cardById.get(cid)!, q })).filter(x => x.c);
    rows.sort(kind === 'give'
      ? (a, b) => Number(theyMiss(b.c.id)) - Number(theyMiss(a.c.id)) || Number(b.q > 1) - Number(a.q > 1) || (a.c.rarity_id ?? 9) - (b.c.rarity_id ?? 9) || cardName(a.c).localeCompare(cardName(b.c), 'fr')
      : (a, b) => Number(missing(b.c.id)) - Number(missing(a.c.id)) || (b.c.rarity_id ?? 9) - (a.c.rarity_id ?? 9) || cardName(a.c).localeCompare(cardName(b.c), 'fr'));
    if (!rows.length) {
      return <p className="pick-empty muted">{kind === 'give' ? "Tu n'as pas encore de carte à donner. Tu peux quand même en demander une." : "Ce membre n'a pas encore de carte."}</p>;
    }
    const holder = kind === 'give' ? 'tu en as' : `${nameOf(d, owner)} en a`;
    return (
      <ul className="pick-cards">
        {rows.map(({ c, q }) => {
          const n = sel.get(c.id) ?? 0;
          return (
            <li key={c.id} className={`pick-row ${rClass(c)}${n ? ' is-on' : ''}`}>
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
    <Modal title="Nouvel échange" onClose={onClose} wide
      footer={to ? <><p className="composer-sum">{summary}</p><button className="btn primary" disabled={!(g + w) || busy} onClick={() => void send()}>Envoyer la proposition</button></> : undefined}>
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
                    <span className="avatar" aria-hidden="true">{initial(p.username)}</span>
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
            <span className="avatar sm" aria-hidden="true">{initial(toName)}</span>
            <span>Échange avec <strong>{toName}</strong></span>
            <button className="btn small ghost" onClick={() => setTo(null)}>Changer de membre</button>
          </div>
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
