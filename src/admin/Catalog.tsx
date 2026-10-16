import { useState, type FormEvent } from 'react';
import type { CardSet, Rarity } from '../lib/types';
import { plural } from '../lib/format';
import { Gems } from '../components/visuals';
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

export function RaritiesAdmin() {
  const { api, d, refresh } = useAdmin();
  const run = useRunner();
  const [rows, setRows] = useState(() => d.rarities.map(r => ({ id: r.id, label: r.label, weight: String(r.weight), is_secret: r.is_secret })));
  const [busy, setBusy] = useState(false);
  const numeric = rows.map(r => ({ id: r.id, weight: Math.max(0, +r.weight || 0) }));
  const o = odds(d, numeric);
  const update = (id: number, patch: Partial<(typeof rows)[number]>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const list = rows.map(r => ({ id: r.id, label: r.label.trim() || d.rarities.find(x => x.id === r.id)!.label, weight: Math.max(0, +r.weight || 0), is_secret: r.is_secret }));
    if (await run(() => api.saveRarities(list), 'Raretés enregistrées')) await refresh();
    setBusy(false);
  }

  return (
    <>
      <div className="view-head"><h2 className="h2">Raretés</h2></div>
      <p className="lead">Pour chaque carte d'un booster, le tirage choisit une rareté selon ces poids, puis une carte au hasard dans cette rareté. Une rareté sans carte disponible est ignorée. Une rareté secrète n'apparaît pas aux membres tant qu'ils n'ont pas obtenu la carte.</p>
      <form onSubmit={save} id="rar-form">
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Rareté</th><th className="num">Poids</th><th className="num">Par carte</th><th className="num">Au moins une par booster</th><th>Secrète</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const x = o.get(r.id);
              return (
                <tr key={r.id} data-rid={r.id}>
                  <td><span className={`rar-name r${r.id}`}><span className="gems"><Gems n={r.id} /></span><input className="input" value={r.label} maxLength={30} onChange={e => update(r.id, { label: e.target.value })} aria-label={`Nom de la rareté ${r.id}`} /></span></td>
                  <td className="num"><input className="input narrow" type="number" min={0} step={0.1} value={r.weight} onChange={e => update(r.id, { weight: e.target.value })} aria-label={`Poids de ${r.label}`} /></td>
                  {x ? <><td className="num odds">{fmtPct(x.p)}</td><td className="num odds">{fmtPct(x.booster)}</td></> : <td className="num odds muted" colSpan={2}>aucune carte à tirer</td>}
                  <td><label className="check"><input type="checkbox" checked={r.is_secret} onChange={e => update(r.id, { is_secret: e.target.checked })} /><span className="sr-only">Rareté secrète</span></label></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <div className="form-foot">
          <p className="muted">Calcul pour un booster standard de {plural(d.settings.booster_size, 'carte', 'cartes')}, avec les cartes publiées actuellement.</p>
          <button className="btn primary" disabled={busy}>Enregistrer les raretés</button>
        </div>
      </form>
    </>
  );
}
