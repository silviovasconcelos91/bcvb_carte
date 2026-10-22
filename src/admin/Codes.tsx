import { useState, type FormEvent } from 'react';
import qrcode from 'qrcode-generator';
import type { BoosterCode, Card } from '../lib/types';
import { CONFIG } from '../config';
import { fmtDateLong, pad2, stripAccents } from '../lib/format';
import { rarityLabel, rClass } from '../lib/lookup';
import { CardView, Logo, MiniArt } from '../components/visuals';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/Confirm';
import { useRunner } from '../components/Toasts';
import { CODE_STATUS, codeCard, codeCardUnreleased, codeReward, codeStatus, posterTitle, useAdmin, useRunRefresh } from './context';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => `${CONFIG.clubShort}-` + Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const appUrl = () => CONFIG.appUrl || `${window.location.origin}/`;
const fold = (s: string) => stripAccents(s).toLowerCase();
const UNRELEASED_WARN = "Publie-la avant l'événement, sinon le code ne fonctionnera pas.";

type Kind = 'booster' | 'random' | 'card';
const KINDS: [Kind, string][] = [['booster', 'Un booster'], ['random', 'Des cartes au hasard'], ['card', 'Une carte précise']];

export function CodesAdmin() {
  const { api, d, refresh } = useAdmin();
  const run = useRunner();
  const runRefresh = useRunRefresh();
  const confirm = useConfirm();
  const empty = { kind: 'booster' as Kind, code: newCode(), label: '', set_id: '', card_count: '1', card_id: '', max_uses: '', expires_at: '' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [poster, setPoster] = useState<BoosterCode | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const picked = form.card_id ? d.cardById.get(+form.card_id) : undefined;

  // Le libellé reprend le nom de la carte s'il est vide ou s'il reprenait celui de la carte précédente
  function pickCard(c: Card) {
    setForm(f => {
      const prev = f.card_id ? d.cardById.get(+f.card_id)?.name : undefined;
      const label = !f.label.trim() || f.label === prev ? c.name : f.label;
      return { ...f, card_id: String(c.id), label };
    });
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (form.kind === 'card' && !picked) return;
    // Une carte précise n'a jamais de série ni de nombre de cartes (contrainte de la base)
    const reward = form.kind === 'card' ? { set_id: null, card_count: null, card_id: picked!.id }
      : { set_id: form.set_id ? +form.set_id : null, card_count: form.kind === 'random' ? +form.card_count : null, card_id: null };
    const row = {
      code: form.code.trim().toUpperCase(), label: form.label.trim() || null, ...reward,
      max_uses: form.max_uses ? +form.max_uses : null, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    };
    setBusy(true);
    if (await run(() => api.saveCode(row), `Code ${row.code} créé`)) { setForm({ ...empty, code: newCode() }); await refresh(); }
    setBusy(false);
  }
  async function stop(c: BoosterCode) {
    await runRefresh(() => api.saveCode({ id: c.id, expires_at: new Date().toISOString() }), 'Code désactivé');
  }
  async function remove(c: BoosterCode) {
    if (!(await confirm.ask('Supprimer le code', `Le code ${c.code} ne fonctionnera plus et son historique d'utilisation sera effacé.`, 'Supprimer'))) return;
    await runRefresh(() => api.deleteCode(c.id), 'Code supprimé');
  }

  const setOptions = d.sets.map(s => <option key={s.id} value={s.id}>Série {s.name}</option>);
  return (
    <>
      <div className="view-head"><h2 className="h2">Codes</h2></div>
      <p className="lead">Chaque code s'utilise une fois par membre et donne un booster, des cartes au hasard ou une carte précise. Affiche-le au gymnase : le QR code ouvre le jeu avec le code déjà saisi.</p>
      <form className="code-new" onSubmit={create}>
        <div className="field span">
          <span id="code-kind">Ce code donne</span>
          <div className="seg code-kind" role="group" aria-labelledby="code-kind">
            {KINDS.map(([k, l]) => <button key={k} type="button" aria-pressed={form.kind === k} onClick={() => set('kind', k)}>{l}</button>)}
          </div>
        </div>
        <label className="field"><span>Code</span><span className="with-btn">
          <input className="input mono" value={form.code} onChange={e => set('code', e.target.value)} required maxLength={30} pattern="[A-Za-z0-9\-]+" title="Lettres, chiffres et tirets" />
          <button type="button" className="btn small" onClick={() => set('code', newCode())}>Autre</button>
        </span></label>
        <label className="field"><span>Libellé</span><input className="input" placeholder={form.kind === 'card' ? 'Soirée du club' : 'Match à domicile du 14/11'} maxLength={80} value={form.label} onChange={e => set('label', e.target.value)} /></label>
        {form.kind === 'booster' && (
          <label className="field"><span>Booster</span><span className="select-wrap"><select className="select" value={form.set_id} onChange={e => set('set_id', e.target.value)}>
            <option value="">Standard</option>{setOptions}
          </select></span></label>
        )}
        {form.kind === 'random' && (
          <>
            <label className="field"><span>Nombre de cartes</span>
              <input className="input" type="number" min={1} max={20} step={1} required value={form.card_count} onChange={e => set('card_count', e.target.value)} />
            </label>
            <label className="field"><span>Série</span><span className="select-wrap"><select className="select" value={form.set_id} onChange={e => set('set_id', e.target.value)} aria-describedby="code-set-help">
              <option value="">Toutes les séries actives</option>{setOptions}
            </select></span><span id="code-set-help" className="hint">Vide : tirées dans toutes les séries actives</span></label>
          </>
        )}
        <label className="field"><span>Utilisations max</span><input className="input" type="number" min={1} placeholder="Illimitées" value={form.max_uses} onChange={e => set('max_uses', e.target.value)} /></label>
        <label className="field"><span>Expire le</span><input className="input" type="datetime-local" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} /></label>
        {form.kind === 'card' && (
          <div className="field span">
            <span id="code-card">Carte offerte</span>
            <div className="card-choice">
              <CardPicker value={picked?.id ?? null} onPick={pickCard} />
              <div className="card-choice-side" aria-live="polite">
                {picked ? (
                  <>
                    <div className="card-choice-preview"><CardView card={picked} /></div>
                    {!picked.is_released && <p className="code-warn"><strong>Non publiée.</strong> {UNRELEASED_WARN}</p>}
                  </>
                ) : <p className="hint">Choisis la carte que recevront les membres qui utilisent ce code.</p>}
              </div>
            </div>
          </div>
        )}
        <div className="span code-submit">
          <button className="btn primary" disabled={busy || (form.kind === 'card' && !picked)}>Créer le code</button>
        </div>
      </form>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Code</th><th>Libellé</th><th>Booster</th><th className="num">Utilisations</th><th>Expiration</th><th>Statut</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {d.codes.length ? d.codes.map(c => {
            const status = codeStatus(c);
            return (
              <tr key={c.id}>
                <td><code>{c.code}</code></td>
                <td>{c.label}</td>
                <td>{codeReward(d, c)}{codeCardUnreleased(d, c) && <> <span className="pill warn">Non publiée</span></>}</td>
                <td className="num">{c.uses_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                <td>{c.expires_at ? fmtDateLong(c.expires_at) : 'Jamais'}</td>
                <td><span className={`pill${status === 'active' ? ' ok' : ''}`}>{CODE_STATUS[status]}</span></td>
                <td className="actions">
                  <button className="btn small" onClick={() => setPoster(c)}>Affiche</button>
                  {status === 'active' && <> <button className="btn small" onClick={() => void stop(c)}>Désactiver</button></>}
                  {' '}<button className="btn small danger" onClick={() => void remove(c)}>Supprimer</button>
                </td>
              </tr>
            );
          }) : <tr><td colSpan={7} className="empty-cell">Aucun code pour l'instant.</td></tr>}
        </tbody>
      </table></div>
      {poster && <Poster code={poster} onClose={() => setPoster(null)} />}
      {confirm.element}
    </>
  );
}

// Sélecteur de carte : recherche par nom, cartes regroupées par série
function CardPicker({ value, onPick }: { value: number | null; onPick: (c: Card) => void }) {
  const { d } = useAdmin();
  const [q, setQ] = useState('');
  const needle = fold(q.trim());
  const groups = d.sets
    .map(s => ({ set: s, cards: d.cards.filter(c => c.set_id === s.id && (!needle || fold(`${c.name} ${c.subtitle ?? ''}`).includes(needle))) }))
    .filter(g => g.cards.length);
  return (
    <div className="card-pick">
      <input className="input" type="search" placeholder="Rechercher une carte" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher une carte" aria-describedby="code-card" />
      <div className="card-pick-list">
        {groups.length ? groups.map(({ set, cards }) => (
          <div key={set.id} role="group" aria-label={`Série ${set.name}`}>
            <p className="card-pick-set">{set.name}</p>
            {cards.map(c => (
              <button key={c.id} type="button" className={`pick-row ${rClass(d.lookup, c)}${c.id === value ? ' is-on' : ''}`} aria-pressed={c.id === value} onClick={() => onPick(c)}>
                <span className="chip-art"><MiniArt card={c} /></span>
                <span className="pick-main">
                  <span className="pick-name">{c.name}{!c.is_released && <span className="tag warn">non publiée</span>}</span>
                  <span className="pick-meta">N° {pad2(c.number)}, {rarityLabel(d.lookup, c.rarity_id)}</span>
                </span>
              </button>
            ))}
          </div>
        )) : <p className="empty-line card-pick-empty">Aucune carte ne correspond.</p>}
      </div>
    </div>
  );
}

// Affiche imprimable : QR code vers le jeu avec le code pré-rempli
function Poster({ code, onClose }: { code: BoosterCode; onClose: () => void }) {
  const { d } = useAdmin();
  const url = `${appUrl()}?code=${encodeURIComponent(code.code)}`;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  const card = codeCard(d, code);
  const set = code.set_id ? d.lookup.setById.get(code.set_id) : undefined;
  const qrBox = <div className="poster-qr" role="img" aria-label={`QR code du code ${code.code}`} dangerouslySetInnerHTML={{ __html: svg }} />;
  return (
    <Modal title={`Affiche du code ${code.code}`} onClose={onClose} wide={!!card}
      footer={<><p className="hint poster-url">{url}</p><span className="foot-btns"><button className="btn primary" onClick={() => window.print()}>Imprimer l'affiche</button></span></>}>
      {card && !card.is_released && <p className="code-warn poster-warn"><strong>Carte non publiée :</strong> le code ne fonctionnera pas tant que « {card.name} » est en préparation. {UNRELEASED_WARN}</p>}
      <div className="poster">
        <div className="poster-brand"><Logo /><span>{CONFIG.clubName}</span></div>
        <p className="poster-title">{posterTitle(d, code)}</p>
        {set && <p className="poster-set">Série {set.name}</p>}
        {card ? <div className="poster-pair"><div className="poster-card"><CardView card={card} size="full" /></div>{qrBox}</div> : qrBox}
        <p className="poster-code">{code.code}</p>
        <p className="poster-help">Scanne le QR code avec ton téléphone, ou saisis ce code dans l'onglet Booster du jeu.</p>
        {code.label && <p className="poster-label">{code.label}</p>}
        {code.expires_at && <p className="poster-label">Valable jusqu'au {fmtDateLong(code.expires_at)}</p>}
      </div>
    </Modal>
  );
}
