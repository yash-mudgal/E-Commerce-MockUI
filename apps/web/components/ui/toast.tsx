"use client";

import { CheckCircle2, AlertCircle, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

type Toast = { id: number; tone: "success" | "error"; message: string };
type Ctx = { notify: (message: string, tone?: Toast["tone"]) => void };

const ToastContext = React.createContext<Ctx | null>(null);

/** Non-intrusive notifications, announced politely to screen readers, auto-dismissed after 4 s. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(1);

  const dismiss = React.useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = React.useCallback(
    (message: string, tone: Toast["tone"] = "success") => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-2), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[var(--radius-card)] border bg-surface px-4 py-3 text-sm text-fg shadow-[var(--shadow-overlay)]",
              t.tone === "error" ? "border-danger/30" : "border-border",
            )}
          >
            {t.tone === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
            <p className="flex-1">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-fg-subtle hover:text-fg" aria-label="Dismiss notification">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
