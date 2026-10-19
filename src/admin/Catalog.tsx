import { useState, type FormEvent } from 'react';
import type { Card, CardSet, Rarity } from '../lib/types';
import { plural } from '../lib/format';
import { CardView, Gems } from '../components/visuals';
import { EFFECTS, LookupContext, RarityStyles, colorOf, fxClass, fxInfo, fxOf, isHex } from '../lib/lookup';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/Confirm';
import { useRunner } from '../components/Toasts';
import { boosterPool, useAdmin, type AdminIndex } from './context';

/* ------------------------------- Séries ------------------------------- */
export function SetsAdmin() {
  const { api, d, refresh } = useAdmin();
  const run = useRunner();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<CardSet | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n && await run(() => api.saveSet({ name: n, in_boosters: true }), `Série « ${n} » créée`)) { setName(''); await refresh(); }
  }
  async function toggle(s: CardSet, on: boolean) {
    if (await run(() => api.saveSet({ ...s, in_boosters: on }), on ? 'Série active dans les boosters' : 'Série retirée des boosters standards')) await refresh();
  }
  async function remove(s: CardSet) {
    if (!(await confirm.ask('Supprimer la série', `La série « ${s.name} » sera supprimée.`, 'Supprimer'))) return;
    if (await run(() => api.deleteSet(s.id), 'Série supprimée')) await refresh();
  }

  return (
    <>
      <div className="view-head"><h2 className="h2">Séries</h2></div>
      <p className="lead">Une série regroupe des cartes numérotées. Seules les séries actives alimentent les boosters gratuits ; une série inactive reste disponible avec un code dédié.</p>
      <form className="toolbar" onSubmit={create}>
        <input className="input grow-input" placeholder="Nom de la nouvelle série, ex. Saison 2027-28" required maxLength={60} value={name} onChange={e => setName(e.target.value)} />
        <button className="btn primary">Créer la série</button>
      </form>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Série</th><th className="num">Cartes publiées</th><th>Boosters standards</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {d.sets.map(s => {
            const all = d.cards.filter(c => c.set_id === s.id);
            return (
              <tr key={s.id}>
                <td><strong>{s.name}</strong></td>
                <td className="num">{all.filter(c => c.is_released).length} / {all.length}</td>
                <td><label className="switch"><input type="checkbox" checked={s.in_boosters} onChange={e => void toggle(s, e.target.checked)} /><span className="switch-ui" aria-hidden="true" /><span>{s.in_boosters ? 'Active' : 'Inactive'}</span></label></td>
                <td className="actions">
                  <button className="btn small" onClick={() => setRenaming(s)}>Renommer</button>
                  {!all.length && <> <button className="btn small danger" onClick={() => void remove(s)}>Supprimer</button></>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {renaming && <RenameSet set={renaming} onClose={() => setRenaming(null)} />}
      {confirm.element}
    </>
  );
}

function RenameSet({ set, onClose }: { set: CardSet; onClose: () => void }) {
  const { api, refresh } = useAdmin();
  const run = useRunner();
  const [name, setName] = useState(set.name);
  async function save() {
    const n = name.trim();
    if (!n) return;
    if (n === set.name) { onClose(); return; }
    if (await run(() => api.saveSet({ ...set, name: n }), 'Série renommée')) { onClose(); await refresh(); }
  }
  return (
    <Modal title="Renommer la série" onClose={onClose}
      footer={<span className="foot-btns"><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={() => void save()}>Enregistrer</button></span>}>
      <form className="field" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label htmlFor="set-name">Nouveau nom</label>
        <input id="set-name" className="input" value={name} onChange={e => setName(e.target.value)} required maxLength={60} />
      </form>
    </Modal>
  );
}

/* ------------------------------- Raretés ------------------------------ */
const fmtPct = (x: number) => `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: x < 0.1 ? 1 : 0 })} %`;

// Probabilité par carte et chance d'en avoir au moins une par booster, avec les cartes tirables aujourd'hui
function odds(d: AdminIndex, rows: Pick<Rarity, 'id' | 'weight'>[]) {
  const pool = boosterPool(d);
  const live = rows.filter(r => r.weight > 0 && pool.some(c => c.rarity_id === r.id));
  const total = live.reduce((s, r) => s + r.weight, 0);
  return new Map(rows.map(r => {
    if (!live.includes(r) || !total) return [r.id, null] as const;
    const p = r.weight / total;
    return [r.id, { p, booster: 1 - (1 - p) ** d.settings.booster_size }] as const;
  }));
}

interface RarRow { id: number; code: string; label: string; weight: string; is_secret: boolean; effect: number; color: string; gems: string; badge: string; isNew?: boolean }
// Symboles proposés à la place des losanges
const BADGES = ['★', '★★', '★★★', '♥', '●', '♛', '⚡', '🔥', '🏐'];

// Losanges d'une ligne : champ vide = selon l'effet, texte vide = losanges
const symbols = (r: Pick<RarRow, 'gems' | 'badge'>) => ({
  gems: r.gems.trim() === '' ? null : Math.max(0, Math.min(10, Math.round(+r.gems) || 0)),
  badge: r.badge.trim().slice(0, 12) || null,
});

export function RaritiesAdmin() {

  const { api, d, refresh } = useAdmin();
  const run = useRunner();
  const confirm = useConfirm();
  const [rows, setRows] = useState<RarRow[]>(() => d.rarities.map(r => ({ id: r.id, code: r.code, label: r.label, weight: String(r.weight), is_secret: r.is_secret, effect: fxOf(r), color: colorOf(r), gems: r.gems == null ? '' : String(r.gems), badge: r.badge ?? '' })));
  const [sel, setSel] = useState(() => rows[0]?.id ?? 1);
  const [busy, setBusy] = useState(false);
  const numeric = rows.map(r => ({ id: r.id, weight: Math.max(0, +r.weight || 0) }));
  const o = odds(d, numeric);
  const update = (id: number, patch: Partial<RarRow>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const used = (id: number) => d.cards.some(c => c.rarity_id === id);
  const current = rows.find(r => r.id === sel) ?? rows[0];

  // Aperçu avec les réglages en cours, pas encore enregistrés
  const draft: Rarity[] = rows.map(r => ({ id: r.id, code: r.code, label: r.label, weight: +r.weight || 0, is_secret: r.is_secret, effect: r.effect, color: r.color, ...symbols(r) }));
  const previewLookup = { ...d.lookup, rarityById: new Map(draft.map(r => [r.id, r])) };
  const sample = d.cards.find(c => c.rarity_id === current?.id && c.is_released) ?? d.cards.find(c => c.is_released) ?? d.cards[0];
  const sampleFor = (rarity_id: number): Card => (sample
    ? { ...sample, rarity_id }
    : { id: 0, set_id: 0, number: 1, name: 'Nom de la carte', subtitle: null, description: null, image_path: null, thumb_path: null, rarity_id, stats: {}, is_released: true, in_boosters: true });

  function add() {
    const id = Math.max(0, ...rows.map(r => r.id)) + 1;
    const fx = EFFECTS[2];
    setRows(rs => [...rs, { id, code: `custom_${id}`, label: 'Nouvelle rareté', weight: '1', is_secret: false, effect: fx.id, color: fx.color, gems: '', badge: '', isNew: true }]);
    setSel(id);
  }
  async function remove(r: RarRow) {
    const drop = () => { setRows(rs => rs.filter(x => x.id !== r.id)); if (sel === r.id) setSel(rows[0]?.id ?? 1); };
    if (r.isNew) { drop(); return; }
    if (!(await confirm.ask('Supprimer la rareté', `La rareté « ${r.label} » sera supprimée.`, 'Supprimer'))) return;
    if (await run(() => api.deleteRarity(r.id), 'Rareté supprimée')) { drop(); await refresh(); }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const list = rows.map(r => ({
      id: r.id, code: r.code, label: r.label.trim() || d.rarities.find(x => x.id === r.id)?.label || `Rareté ${r.id}`,
      weight: Math.max(0, +r.weight || 0), is_secret: r.is_secret, effect: r.effect, color: isHex(r.color) ? r.color.toUpperCase() : null, ...symbols(r),
    }));
    if (await run(() => api.saveRarities(list), 'Raretés enregistrées')) {
      setRows(rs => rs.map(r => ({ ...r, isNew: false })));
      await refresh();
    }
    setBusy(false);
  }

  return (
    <>
      <div className="view-head"><h2 className="h2">Raretés</h2><button type="button" className="btn" onClick={add}>Ajouter une rareté</button></div>
      <p className="lead">Pour chaque carte d'un booster, le tirage choisit une rareté selon ces poids, puis une carte au hasard dans cette rareté. Une rareté sans carte disponible est ignorée. Une rareté secrète n'apparaît pas aux membres tant qu'ils n'ont pas obtenu la carte. L'effet et la couleur règlent l'apparence des cartes et de leur révélation.</p>
      <RarityStyles rarities={draft} />
      {current && (
        <LookupContext.Provider value={previewLookup}>
          <section className="rar-studio" aria-labelledby="fx-title">
            <div className="rar-preview">
              <CardView card={sampleFor(current.id)} tilt size="full" />
              <p className="hint center">Aperçu : {current.label || 'Nouvelle rareté'}</p>
            </div>
            <div>
              <h3 className="h3" id="fx-title">Catalogue d'effets</h3>
              <p className="muted">Choisis l'effet de « {current.label || 'Nouvelle rareté'} », puis sa couleur dans le tableau.</p>
              <div className="fx-grid">
                {EFFECTS.map(fx => (
                  <button key={fx.id} type="button" className={`fx-pick${current.effect === fx.id ? ' is-on' : ''}`} aria-pressed={current.effect === fx.id} onClick={() => update(current.id, { effect: fx.id })}>
                    <LookupContext.Provider value={{ ...previewLookup, rarityById: new Map([...previewLookup.rarityById, [current.id, { ...draft.find(x => x.id === current.id)!, effect: fx.id }]]) }}>
                      <span className="fx-card"><CardView card={sampleFor(current.id)} /></span>
                    </LookupContext.Provider>
                    <span className="fx-name">{fx.label}</span>
                    <span className="fx-desc">{fx.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </LookupContext.Provider>
      )}
      <form onSubmit={save} id="rar-form">
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Rareté</th><th>Effet</th><th>Couleur</th><th>Losanges</th><th className="num">Poids</th><th className="num">Par carte</th><th className="num">Au moins une par booster</th><th>Secrète</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map(r => {
              const x = o.get(r.id);
              return (
                <tr key={r.id} data-rid={r.id} className={r.id === sel ? 'is-sel' : undefined} onFocusCapture={() => setSel(r.id)} onClick={() => setSel(r.id)}>
                  <td><span className={`rar-name ${fxClass(r.effect, r.id)}`}><span className="gems"><Gems r={{ id: r.id, effect: r.effect, ...symbols(r) }} /></span><input className="input" value={r.label} maxLength={30} onChange={e => update(r.id, { label: e.target.value })} aria-label={`Nom de la rareté ${r.id}`} /></span></td>
                  <td><span className="select-wrap"><select className="select" value={r.effect} onChange={e => update(r.id, { effect: +e.target.value })} aria-label={`Effet de ${r.label}`}>
                    {EFFECTS.map(fx => <option key={fx.id} value={fx.id}>{fx.label}</option>)}
                  </select></span></td>
                  <td><input className="color-input" type="color" value={r.color} onChange={e => update(r.id, { color: e.target.value })} aria-label={`Couleur de ${r.label}`} /></td>
                  <td><span className="rar-symbol">
                    <input className="input tiny" type="number" min={0} max={10} step={1} placeholder={String(fxInfo(r.effect).level >= 6 ? 1 : fxInfo(r.effect).level)} value={r.gems} disabled={!!r.badge.trim()} onChange={e => update(r.id, { gems: e.target.value })} aria-label={`Nombre de losanges de ${r.label} (vide : selon l’effet)`} title="Vide : selon l’effet" />
                    <input className="input short" list="rar-badges" maxLength={12} placeholder="ou texte" value={r.badge} onChange={e => update(r.id, { badge: e.target.value })} aria-label={`Texte à la place des losanges de ${r.label}`} title="Remplace les losanges, ex. ★★ ou SR" />
                  </span></td>
                  <td className="num"><input className="input narrow" type="number" min={0} step={0.1} value={r.weight} onChange={e => update(r.id, { weight: e.target.value })} aria-label={`Poids de ${r.label}`} /></td>
                  {x ? <><td className="num odds">{fmtPct(x.p)}</td><td className="num odds">{fmtPct(x.booster)}</td></> : <td className="num odds muted" colSpan={2}>aucune carte à tirer</td>}
                  <td><label className="check"><input type="checkbox" checked={r.is_secret} onChange={e => update(r.id, { is_secret: e.target.checked })} /><span className="sr-only">Rareté secrète</span></label></td>
                  <td className="actions">
                    {r.isNew && <span className="tag">non enregistrée</span>}
                    {(r.isNew || !used(r.id)) && <> <button type="button" className="btn small danger" onClick={() => void remove(r)}>Supprimer</button></>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <datalist id="rar-badges">{BADGES.map(b => <option key={b} value={b} />)}</datalist>
        <div className="form-foot">
          <p className="muted">Calcul pour un booster standard de {plural(d.settings.booster_size, 'carte', 'cartes')}, avec les cartes publiées actuellement. Une rareté utilisée par des cartes ne peut pas être supprimée : mets son poids à 0 pour la retirer du tirage.</p>
          <button className="btn primary" disabled={busy}>Enregistrer les raretés</button>
        </div>
      </form>
      {confirm.element}
    </>
  );
}
