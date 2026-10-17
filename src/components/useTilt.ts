import { useMemo, type PointerEvent } from 'react';
import { reduceMotion } from '../lib/format';

// Effet holographique : la carte suit la souris (pas le doigt, pour ne pas gêner le défilement)
export function useTilt(enabled: boolean) {
  return useMemo(() => {
    if (!enabled) return {};
    return {
      onPointerMove(e: PointerEvent<HTMLDivElement>) {
        if (e.pointerType !== 'mouse' || reduceMotion()) return;
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
        el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
        el.style.setProperty('--px', `${(x * 100).toFixed(1)}%`);
        el.style.setProperty('--py', `${(y * 100).toFixed(1)}%`);
        el.style.setProperty('--hx', x.toFixed(3));
        el.style.setProperty('--rx', `${((0.5 - y) * 16).toFixed(2)}deg`);
        el.style.setProperty('--ry', `${((x - 0.5) * 20).toFixed(2)}deg`);
        el.classList.add('is-active');
      },
      onPointerLeave(e: PointerEvent<HTMLDivElement>) {
        const el = e.currentTarget;
        el.classList.remove('is-active');
        el.style.removeProperty('--rx');
        el.style.removeProperty('--ry');
      },
    };
  }, [enabled]);
}
