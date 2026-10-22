import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Card, Photo, Rarity, Stats, Subtitle } from '../lib/types';
import { statLabel } from '../lib/format';
import { useToast } from './Toasts';

const STAT_KEYS = ['service', 'attaque', 'reception', 'bloc', 'passe', 'defense', 'tactique'];
const PHOTO = 720; // côté du carré exporté, en pixels
const THUMB = 240; // côté de la vignette des petits affichages

export interface CardDraft {
  name: string;
  subtitle: string;
  description: string;
  rarity_id: number;
  numero: string;
  stats: { k: string; v: number }[];
}

type CardTexts = Pick<Card, 'name' | 'subtitle' | 'description' | 'rarity_id' | 'stats'>;

export function draftFrom(c: CardTexts | null, rarityId: number): CardDraft {
  const entries = Object.entries(c?.stats ?? {}).filter(([k]) => k !== 'numero').slice(0, 4);
  return {
    name: c?.name ?? '', subtitle: c?.subtitle ?? '', description: c?.description ?? '',
    rarity_id: c?.rarity_id ?? rarityId, numero: c?.stats?.numero != null ? String(c.stats.numero) : '',
    stats: [0, 1, 2, 3].map(i => ({ k: entries[i]?.[0] ?? '', v: entries[i]?.[1] ?? 5 })),
  };
}

export function draftFields(d: CardDraft): CardTexts {
  const stats: Stats = {};
  if (d.numero !== '') stats.numero = Math.max(0, Math.min(99, +d.numero));
  for (const s of d.stats) if (s.k) stats[s.k] = s.v;
  return { name: d.name.trim(), subtitle: d.subtitle.trim() || null, description: d.description.trim() || null, rarity_id: d.rarity_id, stats };
}

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

export type Crop = { zoom: number; px: number; py: number };

// Choix de la photo et recadrage : carré de 720 px, zoom et position réglables
export function useCardPhoto() {
  const toast = useToast();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, px: 50, py: 50 });
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const canvas = useRef(document.createElement('canvas'));

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
  useEffect(() => { setDataUrl(drawCrop()); }, [img, crop]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Choisis un fichier image (JPEG, PNG…).', true); return; }
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { setImg(im); setCrop({ zoom: 1, px: 50, py: 50 }); URL.revokeObjectURL(url); };
    im.onerror = () => { URL.revokeObjectURL(url); toast("Cette image n'a pas pu être lue.", true); };
    im.src = url;
  }

  function clear() { setImg(null); setDataUrl(null); }

  // null si aucune photo n'est choisie, ou si elle n'a pas pu être préparée (un message est alors affiché :
  // l'appelant distingue les deux cas avec `img`)
  async function exportPhoto(): Promise<Photo | null> {
    if (!img || !drawCrop()) return null;
    const small = thumbOf(canvas.current);
    const [full, thumb] = await Promise.all([toJpeg(canvas.current, 0.85), small && toJpeg(small, 0.8)]);
    if (!full || !thumb) { toast("La photo n'a pas pu être préparée.", true); return null; }
    return { full, thumb };
  }

  return { img, crop, setCrop, dataUrl, pick, clear, exportPhoto };
}

export function CardFields({ draft, onChange, rarities, subtitles }: { draft: CardDraft; onChange(d: CardDraft): void; rarities: Rarity[]; subtitles: Subtitle[] }) {
  const set = <K extends keyof CardDraft>(k: K, v: CardDraft[K]) => onChange({ ...draft, [k]: v });
  return (
    <>
      <label className="field"><span>Nom</span><input className="input" maxLength={40} required value={draft.name} placeholder="Ex. Léa ou Contre gagnant" onChange={e => set('name', e.target.value)} /></label>
      <div className="row2">
        <label className="field"><span>Sous-titre</span><input className="input" list="subtitles" maxLength={40} value={draft.subtitle} placeholder="Poste, Action, Moment…" onChange={e => set('subtitle', e.target.value)} /></label>
        <label className="field"><span>Rareté</span><span className="select-wrap"><select className="select" value={draft.rarity_id} onChange={e => set('rarity_id', +e.target.value)}>
          {rarities.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select></span></label>
      </div>
      <datalist id="subtitles">{subtitles.map(s => <option key={s.id} value={s.label} />)}</datalist>
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
    </>
  );
}

export function PhotoField({ photo, canRemove, onRemove }: { photo: ReturnType<typeof useCardPhoto>; canRemove: boolean; onRemove(): void }) {
  const { img, crop, setCrop } = photo;
  return (
    <fieldset className="fs">
      <legend>Photo</legend>
      <div className="photo-row">
        <label className="btn small file-btn">Choisir une photo<input type="file" accept="image/*" className="sr-only" onChange={photo.pick} /></label>
        {canRemove && (
          <button type="button" className="btn small ghost" onClick={() => { photo.clear(); onRemove(); }}>Retirer la photo</button>
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
  );
}
