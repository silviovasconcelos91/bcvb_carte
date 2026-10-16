import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Toast = { id: number; msg: string; error: boolean };
type ToastFn = (msg: string, error?: boolean) => void;
const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

let nextId = 1;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback<ToastFn>((msg, error = false) => {
    const id = nextId++;
    setToasts(t => [...t, { id, msg, error }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), error ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={`toast${t.error ? ' err' : ''}`}>{t.msg}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

// Enchaîne une action et affiche son résultat (succès ou message d'erreur)
export function useRunner() {
  const toast = useToast();
  return useCallback(async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
      return false;
    }
  }, [toast]);
}
