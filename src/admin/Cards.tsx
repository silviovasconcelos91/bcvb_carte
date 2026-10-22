import { useMemo, useState } from 'react';
import type { Card } from '../lib/types';
import { pad2, plural } from '../lib/format';
import { LookupContext, isSecret, rClass, rarityLabel } from '../lib/lookup';
import { CardView, MiniArt } from '../components/visuals';
import { Modal } from '../components/Modal';
import { CardFields, PhotoField, draftFields, draftFrom, useCardPhoto, type CardDraft } from '../components/CardForm';
import { useConfirm } from '../components/Confirm';
import { useRunner, useToast } from '../components/Toasts';
import type { CardInput } from '../api/admin';
import { useAdmin } from './context';

export function CardsAdmin() {
  const { d } = useAdmin();
  const [set, setSet] = useState('all');
  const [rar, setRar] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const needle = q.trim().toLowerCase();
  const list = d.cards.filter(c => (set === 'all' || String(c.set_id) === set) && (rar === 'all' || String(c.rarity_id) === rar)
    && (!needle || `${c.name} ${c.subtitle ?? ''}`.toLowerCase().includes(needle)));

  return (
    <>
      <div className="view-head"><h2 className="h2">Cartes</h2><button className="btn primary" onClick={() => setEditing('new')}>Nouvelle carte</button></div>
      <div className="toolbar">
        <span className="select-wrap"><select className="select" value={set} onChange={e => setSet(e.target.value)} aria-label="Série">
          <option value="all">Toutes les séries</option>{d.sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></span>
        <span className="select-wrap"><select className="select" value={rar} onChange={e => setRar(e.target.value)} aria-label="Rareté">
          <option value="all">Toutes les raretés</option>{d.rarities.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select></span>
        <input className="input search" type="search" placeholder="Rechercher une carte" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher une carte" />
      </div>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Carte</th><th>Série</th><th className="num">N°</th><th>Rareté</th><th>Statut</th><th className="num">Possédée par</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {list.length ? list.map(c => {
            const owners = d.owners.get(c.id) ?? 0;
            return (
              <tr key={c.id}>
                <td><span className="cell-card"><span className={`chip-art ${rClass(d.lookup, c)}`}><MiniArt card={c} /></span><span className="cell-text"><strong>{c.name}</strong><span className="muted">{c.subtitle}</span></span></span></td>
                <td>{d.lookup.setById.get(c.set_id)?.name}</td>
                <td className="num">{pad2(c.number)}</td>
                <td><span className={`rlabel ${rClass(d.lookup, c)}`}><i />{rarityLabel(d.lookup, c.rarity_id)}</span></td>
                <td><span className="pills">
                  {c.is_released ? <span className="pill ok">Publiée</span> : <span className="pill warn">En préparation</span>}
                  {c.is_released && c.in_boosters === false && <span className="pill">Hors boosters</span>}
                </span></td>
                <td className="num">{owners ? plural(owners, 'membre', 'membres') : '–'}</td>
                <td className="actions"><button className="btn small" onClick={() => setEditing(c.id)}>Modifier</button></td>
              </tr>
            );
          }) : <tr><td colSpan={7} className="empty-cell">Aucune carte ne correspond.</td></tr>}
        </tbody>
      </table></div>
      {editing != null && <CardEditor id={editing === 'new' ? null : editing} defaultSet={set === 'all' ? null : +set} onClose={() => setEditing(null)} />}
    </>
  );
}

type Draft = CardDraft & { set_id: number; number: string; is_released: boolean; in_boosters: boolean };

function toDraft(c: Card | null, setId: number, nextNumber: number, rarityId: number): Draft {
  return {
    ...draftFrom(c, rarityId),
    set_id: c?.set_id ?? setId, number: String(c?.number ?? nextNumber),
    is_released: c?.is_released ?? false, in_boosters: c?.in_boosters ?? true,
  };
}

function CardEditor({ id, defaultSet, onClose }: { id: number | null; defaultSet: number | null; onClose: () => void }) {
  const { api, d, refresh } = useAdmin();
  const toast = useToast();
  const run = useRunner();
  const confirm = useConfirm();
  const base = id ? d.cardById.get(id) ?? null : null;
  const firstSet = defaultSet ?? d.sets[0]?.id ?? 0;
  const nextNumber = Math.max(0, ...d.cards.filter(c => c.set_id === firstSet).map(c => c.number ?? 0)) + 1;
  const [draft, setDraft] = useState<Draft>(() => toDraft(base, firstSet, nextNumber, d.rarities[0]?.id ?? 1));
  const photo = useCardPhoto();
  const [removedFlag, setRemoved] = useState(false);
  const removed = removedFlag && !photo.img; // choisir une nouvelle photo annule le retrait
  const [busy, setBusy] = useState(false);
  const owners = id ? d.owners.get(id) ?? 0 : 0;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(prev => ({ ...prev, [k]: v }));

  function toInput(): CardInput {
    return {
      ...(id ? { id } : {}), set_id: draft.set_id, number: draft.number === '' ? null : +draft.number, ...draftFields(draft),
      is_released: draft.is_released, in_boosters: draft.in_boosters,
      image_path: removed ? null : base?.image_path ?? null, thumb_path: removed ? null : base?.thumb_path ?? null,
    };
  }

  // Aperçu : la photo recadrée et le total de la série tel qu'il sera après l'enregistrement
  // (une carte secrète n'entre pas dans le total, comme dans makeLookup)
  const preview = toInput();
  const previewLookup = useMemo(() => {
    const setCount = new Map(d.lookup.setCount);
    const bump = (setId: number, n: number) => setCount.set(setId, (setCount.get(setId) ?? 0) + n);
    if (base && !isSecret(d.lookup, base)) bump(base.set_id, -1);
    if (!isSecret(d.lookup, { rarity_id: draft.rarity_id })) bump(draft.set_id, 1);
    return { ...d.lookup, setCount, urls: photo.dataUrl ? { ...d.lookup.urls, __draft__: photo.dataUrl } : d.lookup.urls };
  }, [d.lookup, base, draft.set_id, draft.rarity_id, photo.dataUrl]);
  const previewCard: Card = { ...preview, id: id ?? 0, name: preview.name || 'Nom de la carte', image_path: photo.dataUrl ? '__draft__' : preview.image_path, thumb_path: photo.dataUrl ? null : preview.thumb_path };

  async function save() {
    const input = toInput();
    if (!input.name) { toast('Donne un nom à la carte.', true); return; }
    if (!input.number) { toast('Indique le numéro de la carte dans sa série.', true); return; }
    setBusy(true);
    const upload = await photo.exportPhoto();
    if (photo.img && !upload) { setBusy(false); return; } // message déjà affiché
    const old = base && (upload || removed) ? { image_path: base.image_path, thumb_path: base.thumb_path } : null;
    if (await run(() => api.saveCard(input, upload, old), id ? 'Carte enregistrée' : 'Carte créée')) { onClose(); await refresh(); }
    else setBusy(false);
  }
  async function remove() {
    if (!base) return;
    if (!(await confirm.ask('Supprimer la carte', `« ${base.name} » sera définitivement supprimée, avec sa photo.`, 'Supprimer'))) return;
    if (await run(() => api.deleteCard(base), 'Carte supprimée')) { onClose(); await refresh(); }
  }

  const footer = (
    <>
      {id ? (owners
        ? <p className="hint">Déjà obtenue par {plural(owners, 'membre', 'membres')} : pour la retirer, décoche « Peut tomber dans les boosters ».</p>
        : <button className="btn danger" onClick={() => void remove()}>Supprimer la carte</button>) : <span />}
      <span className="foot-btns"><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy} onClick={() => void save()}>Enregistrer</button></span>
    </>
  );

  return (
    <>
      <Modal title={base ? `Modifier « ${base.name} »` : 'Nouvelle carte'} onClose={onClose} wide footer={footer}>
        <div className="editor">
          <form className="editor-form" autoComplete="off" onSubmit={e => { e.preventDefault(); void save(); }}>
            <div className="row2">
              <label className="field"><span>Série</span><span className="select-wrap"><select className="select" value={draft.set_id} onChange={e => set('set_id', +e.target.value)}>
                {d.sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></span></label>
              <label className="field"><span>Numéro</span><input className="input" type="number" min={1} value={draft.number} onChange={e => set('number', e.target.value)} required /></label>
            </div>
            <CardFields draft={draft} onChange={x => setDraft(prev => ({ ...prev, ...x }))} rarities={d.rarities} subtitles={d.subtitles} />
            <PhotoField photo={photo} canRemove={!!(photo.img || (base?.image_path && !removed))} onRemove={() => setRemoved(true)} />
            <label className="check"><input type="checkbox" checked={draft.is_released} onChange={e => set('is_released', e.target.checked)} /> Publiée : visible par les membres</label>
            <label className="check"><input type="checkbox" checked={draft.in_boosters} onChange={e => set('in_boosters', e.target.checked)} /> Peut tomber dans les boosters</label>
          </form>
          <div className="editor-side">
            <div className="editor-preview" id="card-preview">
              <LookupContext.Provider value={previewLookup}><CardView card={previewCard} tilt size="full" /></LookupContext.Provider>
            </div>
            <p className="hint center">Aperçu tel que le verront les membres</p>
          </div>
        </div>
      </Modal>
      {confirm.element}
    </>
  );
}
