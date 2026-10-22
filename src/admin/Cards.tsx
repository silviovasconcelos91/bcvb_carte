import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { Card, Stats } from '../lib/types';
import { pad2, plural, statLabel } from '../lib/format';
import { LookupContext, isSecret, rClass, rarityLabel } from '../lib/lookup';
import { CardView, MiniArt } from '../components/visuals';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/Confirm';
import { useRunner, useToast } from '../components/Toasts';
import type { CardInput, Photo } from '../api/admin';
import { useAdmin } from './context';

const STAT_KEYS = ['service', 'attaque', 'reception', 'bloc', 'passe', 'defense', 'tactique'];
const PHOTO = 720; // côté du carré exporté, en pixels
const THUMB = 240; // côté de la vignette des petits affichages

const toJpeg = (cv: HTMLCanvasElement, quality: number) => new Promise<Blob | null>(res => cv.toBlob(res, 'image/jpeg', quality));

// Vignette dessinée à partir du carré de 720 px : même cadrage que la photo
function thumbOf(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const cv = document.createElement('canvas');
  cv.width = cv.height = THUMB;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, THUMB, THUMB);
  return cv;
}

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

interface Draft {
  set_id: number;
  number: string;
  name: string;
  subtitle: string;
  description: string;
  rarity_id: number;
  numero: string;
  stats: { k: string; v: number }[];
  is_released: boolean;
  in_boosters: boolean;
}

function toDraft(c: Card | null, setId: number, nextNumber: number, rarityId: number): Draft {
  const entries = Object.entries(c?.stats ?? {}).filter(([k]) => k !== 'numero').slice(0, 4);
  return {
    set_id: c?.set_id ?? setId, number: String(c?.number ?? nextNumber), name: c?.name ?? '', subtitle: c?.subtitle ?? '',
    description: c?.description ?? '', rarity_id: c?.rarity_id ?? rarityId, numero: c?.stats?.numero != null ? String(c.stats.numero) : '',
    stats: [0, 1, 2, 3].map(i => ({ k: entries[i]?.[0] ?? '', v: entries[i]?.[1] ?? 5 })),
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
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState({ zoom: 1, px: 50, py: 50 });
  const [photo, setPhoto] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvas = useRef(document.createElement('canvas'));
  const owners = id ? d.owners.get(id) ?? 0 : 0;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(prev => ({ ...prev, [k]: v }));

  // Recadrage : carré de 720 px, zoom et position réglables
  function drawCrop(): string | null {
    if (!img) return null;
    const cv = canvas.current;
    cv.width = cv.height = PHOTO;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    const scale = Math.max(PHOTO / img.naturalWidth, PHOTO / img.naturalHeight) * crop.zoom;
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PHOTO, PHOTO);
    ctx.drawImage(img, (PHOTO - w) * (crop.px / 100), (PHOTO - h) * (crop.py / 100), w, h);
    return cv.toDataURL('image/jpeg', 0.85);
  }
  useEffect(() => { setPhoto(drawCrop()); }, [img, crop]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Choisis un fichier image (JPEG, PNG…).', true); return; }
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { setImg(im); setCrop({ zoom: 1, px: 50, py: 50 }); setRemoved(false); URL.revokeObjectURL(url); };
    im.onerror = () => { URL.revokeObjectURL(url); toast("Cette image n'a pas pu être lue.", true); };
    im.src = url;
  }

  function toInput(): CardInput {
    const stats: Stats = {};
    if (draft.numero !== '') stats.numero = Math.max(0, Math.min(99, +draft.numero));
    for (const s of draft.stats) if (s.k) stats[s.k] = s.v;
    return {
      ...(id ? { id } : {}), set_id: draft.set_id, number: draft.number === '' ? null : +draft.number, name: draft.name.trim(),
      subtitle: draft.subtitle.trim() || null, description: draft.description.trim() || null, rarity_id: draft.rarity_id, stats,
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
    return { ...d.lookup, setCount, urls: photo ? { ...d.lookup.urls, __draft__: photo } : d.lookup.urls };
  }, [d.lookup, base, draft.set_id, draft.rarity_id, photo]);
  const previewCard: Card = { ...preview, id: id ?? 0, name: preview.name || 'Nom de la carte', image_path: photo ? '__draft__' : preview.image_path, thumb_path: photo ? null : preview.thumb_path };

  async function save() {
    const input = toInput();
    if (!input.name) { toast('Donne un nom à la carte.', true); return; }
    if (!input.number) { toast('Indique le numéro de la carte dans sa série.', true); return; }
    setBusy(true);
    let upload: Photo | null = null;
    if (img && drawCrop()) {
      const small = thumbOf(canvas.current);
      const [full, thumb] = await Promise.all([toJpeg(canvas.current, 0.85), small && toJpeg(small, 0.8)]);
      if (!full || !thumb) { toast("La photo n'a pas pu être préparée.", true); setBusy(false); return; }
      upload = { full, thumb };
    }
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
            <label className="field"><span>Nom</span><input className="input" maxLength={40} required value={draft.name} placeholder="Ex. Léa ou Contre gagnant" onChange={e => set('name', e.target.value)} /></label>
            <div className="row2">
              <label className="field"><span>Sous-titre</span><input className="input" list="subtitles" maxLength={40} value={draft.subtitle} placeholder="Poste, Action, Moment…" onChange={e => set('subtitle', e.target.value)} /></label>
              <label className="field"><span>Rareté</span><span className="select-wrap"><select className="select" value={draft.rarity_id} onChange={e => set('rarity_id', +e.target.value)}>
                {d.rarities.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select></span></label>
            </div>
            <datalist id="subtitles">{d.subtitles.map(s => <option key={s.id} value={s.label} />)}</datalist>
            <fieldset className="fs">
              <legend>Statistiques</legend>
              <p className="hint">Facultatives, notées sur 10. Une carte sans statistiques affiche sa description à la place.</p>
              <label className="field inline"><span>N° de maillot</span><input className="input narrow" type="number" min={0} max={99} value={draft.numero} onChange={e => set('numero', e.target.value)} /></label>
              {draft.stats.map((s, i) => {
                const keys = [...new Set([...STAT_KEYS, ...(s.k ? [s.k] : [])])];
                const update = (patch: Partial<{ k: string; v: number }>) => set('stats', draft.stats.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div className="stat-row" key={i}>
                    <span className="select-wrap"><select className="select" value={s.k} onChange={e => update({ k: e.target.value })} aria-label={`Statistique ${i + 1}`}>
                      <option value="">Aucune</option>{keys.map(k => <option key={k} value={k}>{statLabel(k)}</option>)}
                    </select></span>
                    <input type="range" min={0} max={10} step={1} value={s.v} disabled={!s.k} onChange={e => update({ v: +e.target.value })} aria-label="Valeur sur 10" />
                    <output>{s.k ? s.v : ''}</output>
                  </div>
                );
              })}
            </fieldset>
            <label className="field"><span>Description</span><textarea className="input textarea" maxLength={160} value={draft.description} placeholder="Une phrase qui raconte la carte" onChange={e => set('description', e.target.value)} /></label>
            <fieldset className="fs">
              <legend>Photo</legend>
              <div className="photo-row">
                <label className="btn small file-btn">Choisir une photo<input type="file" accept="image/*" className="sr-only" onChange={pickFile} /></label>
                {(img || (base?.image_path && !removed)) && (
                  <button type="button" className="btn small ghost" onClick={() => { setImg(null); setPhoto(null); setRemoved(true); }}>Retirer la photo</button>
                )}
              </div>
              {img && (
                <div className="crop">
                  <label className="field inline"><span>Zoom</span><input type="range" min={1} max={3} step={0.01} value={crop.zoom} onChange={e => setCrop({ ...crop, zoom: +e.target.value })} /></label>
                  <label className="field inline"><span>Horizontal</span><input type="range" min={0} max={100} value={crop.px} onChange={e => setCrop({ ...crop, px: +e.target.value })} /></label>
                  <label className="field inline"><span>Vertical</span><input type="range" min={0} max={100} value={crop.py} onChange={e => setCrop({ ...crop, py: +e.target.value })} /></label>
                </div>
              )}
              <p className="hint">La photo est recadrée en carré et réduite automatiquement avant l'envoi.</p>
            </fieldset>
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
