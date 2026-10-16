import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from './visuals';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

const stack: number[] = [];
let nextId = 1;

export function Modal({ title, onClose, children, footer, wide = false }: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = nextId++;
    stack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    document.body.classList.add('no-scroll');
    const first = boxRef.current?.querySelector<HTMLElement>('.modal-body input:not([type=hidden]):not([type=file]), .modal-body select, .modal-body textarea')
      ?? boxRef.current?.querySelector<HTMLElement>('[data-close]');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && stack[stack.length - 1] === id) closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(id), 1);
      if (!stack.length) document.body.classList.remove('no-scroll');
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);
  return createPortal(
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={boxRef} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" data-close onClick={onClose} aria-label="Fermer"><IconX /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
