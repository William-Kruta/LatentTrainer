import { createContext, useCallback, useContext, useEffect, useReducer } from "react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

type Action =
  | { type: "add"; toast: ToastItem }
  | { type: "remove"; id: number };

let _nextId = 0;

function reducer(state: ToastItem[], action: Action): ToastItem[] {
  if (action.type === "add") return [...state, action.toast];
  return state.filter((t) => t.id !== action.id);
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}

function ToastEntry({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const duration = toast.type === "error" ? 5000 : 3000;
    const id = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(id);
  }, [toast.type, onDismiss]);

  return (
    <div className={`toast toast-${toast.type}`} role="alert">
      <span className="toast-message">{toast.message}</span>
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, []);

  const add = useCallback((message: string, type: ToastType) => {
    const id = ++_nextId;
    dispatch({ type: "add", toast: { id, type, message } });
  }, []);

  const value: ToastContextValue = {
    success: useCallback((m) => add(m, "success"), [add]),
    error: useCallback((m) => add(m, "error"), [add]),
    info: useCallback((m) => add(m, "info"), [add]),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <ToastEntry
            key={t.id}
            toast={t}
            onDismiss={() => dispatch({ type: "remove", id: t.id })}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
