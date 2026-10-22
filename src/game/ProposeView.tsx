import { useEffect, useMemo, useState } from 'react';
import { PROPOSAL_LIMIT_MSG, PROPOSAL_MAX, partialCard } from '../api/game';
import type { Proposal, Subtitle } from '../lib/types';
import { errMsg, relTime } from '../lib/format';
import { LookupContext } from '../lib/lookup';
import { CardView } from '../components/visuals';
import { CardFields, PhotoField, draftFields, draftFrom, useCardPhoto } from '../components/CardForm';
import { useToast } from '../components/Toasts';
import { useGame } from './context';

export function ProposeView() {
  const { api, d, uid } = useGame();
  const toast = useToast();
  const rarities = useMemo(() => d.rarities.filter(r => !r.is_secret), [d.rarities]);
  const firstRarity = rarities[0]?.id ?? 0;
  const [draft, setDraft] = useState(() => draftFrom(null, firstRarity));
  const photo = useCardPhoto();
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const list = await api.myProposals();
    const paths = list.flatMap(p => [p.thumb_path, p.image_path]);
    const signed = paths.length ? await api.imageUrls(paths).catch(() => ({} as Record<string, string>)) : {};
    setUrls(signed);
    setProposals(list);
  }

  useEffect(() => {
    let alive = true;
    api.subtitles().then(s => { if (alive) setSubtitles(s); }, () => {});
    load().catch(e => { if (alive) setError(errMsg(e)); });
    return () => { alive = false; };
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = proposals?.length ?? 0;
  const full = count >= PROPOSAL_MAX;

  // Aperçu : la photo recadrée sous l'identifiant factice __draft__
  const previewLookup = useMemo(
    () => ({ ...d.lookup, urls: photo.dataUrl ? { ...d.lookup.urls, __draft__: photo.dataUrl } : d.lookup.urls }),
    [d.lookup, photo.dataUrl],
  );
  const fields = draftFields(draft);
  const previewCard = partialCard({
    id: 0, ...fields, name: fields.name || 'Nom de la carte', set_id: 0, number: null,
    image_path: photo.dataUrl ? '__draft__' : null, thumb_path: null,
  });
  const listLookup = useMemo(() => ({ ...d.lookup, urls: { ...d.lookup.urls, ...urls } }), [d.lookup, urls]);

  async function submit() {
    const input = draftFields(draft);
    if (!input.name) { toast('Donne un nom à la carte.', true); return; }
    if (!photo.img) { toast('Ajoute une photo.', true); return; }
    setBusy(true);
    try {
      const upload = await photo.exportPhoto();
      if (!upload) return; // message déjà affiché
      await api.propose(uid, { name: input.name, subtitle: input.subtitle, description: input.description, stats: input.stats, rarity_id: draft.rarity_id }, upload);
      toast('Merci ! Ta proposition a été envoyée.');
      setDraft(draftFrom(null, firstRarity));
      photo.clear();
      setError(null);
    } catch (e) {
      toast(errMsg(e), true);
      return;
    } finally {
      setBusy(false);
    }
    // Envoi réussi : une erreur de rechargement ne doit pas passer pour un échec de l'envoi
    load().catch(e => setError(errMsg(e)));
  }

  return (
    <section aria-labelledby="pr-title">
      <h2 className="lb-title" id="pr-title">Proposer une carte</h2>
      <p className="lb-lead">Une idée de carte ? Envoie-la, elle sera examinée avant d'entrer dans le jeu.</p>
      <div className="editor propose-form">
        <form className="editor-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
          {full && <p className="hint" role="status">{PROPOSAL_LIMIT_MSG}</p>}
          {/* Limite atteinte : tout le formulaire est désactivé, pas seulement le bouton */}
          <fieldset className="pr-fields" disabled={full}>
            <CardFields draft={draft} onChange={setDraft} rarities={rarities} subtitles={subtitles} />
            <PhotoField photo={photo} canRemove={!!photo.img} onRemove={() => {}} />
            <div>
              <button type="submit" className="btn" disabled={busy || full}>{busy ? 'Envoi…' : 'Proposer'}</button>
            </div>
          </fieldset>
        </form>
        <div className="editor-side">
          <div className="editor-preview">
            <LookupContext.Provider value={previewLookup}><CardView card={previewCard} tilt size="full" /></LookupContext.Provider>
          </div>
          <p className="hint center">Aperçu de ta carte</p>
        </div>
      </div>

      <h2 className="pr-sub">Mes propositions en attente ({count} / {PROPOSAL_MAX})</h2>
      {error ? (
        <div className="empty"><h3>Impossible de charger tes propositions</h3><p>{error}</p></div>
      ) : !proposals ? (
        <p className="lb-lead">Chargement…</p>
      ) : !proposals.length ? (
        <p className="lb-lead">Aucune proposition en attente.</p>
      ) : (
        <LookupContext.Provider value={listLookup}>
          <ul className="binder pr-list">
            {proposals.map(p => (
              <li key={p.id} className="pr-item">
                <CardView card={partialCard({ id: -p.id, name: p.name, subtitle: p.subtitle, description: p.description, stats: p.stats, rarity_id: p.rarity_id, image_path: p.image_path, thumb_path: p.thumb_path })} />
                <span className="hint center">{relTime(p.created_at)}</span>
              </li>
            ))}
          </ul>
        </LookupContext.Provider>
      )}
    </section>
  );
}
