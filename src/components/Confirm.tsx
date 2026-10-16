import { useState } from 'react';
import { Modal } from './Modal';

// Fenêtre de confirmation (les boîtes natives sont parfois bloquées)
export function useConfirm() {
  const [state, setState] = useState<{ title: string; text: string; label: string; resolve: (ok: boolean) => void } | null>(null);
  const ask = (title: string, text: string, label: string) => new Promise<boolean>(resolve => setState({ title, text, label, resolve }));
  const close = (ok: boolean) => { state?.resolve(ok); setState(null); };
  const element = state && (
    <Modal title={state.title} onClose={() => close(false)}
      footer={<span className="foot-btns"><button className="btn" onClick={() => close(false)}>Annuler</button><button className="btn danger-solid" onClick={() => close(true)}>{state.label}</button></span>}>
      <p>{state.text}</p>
    </Modal>
  );
  return { ask, element };
}
