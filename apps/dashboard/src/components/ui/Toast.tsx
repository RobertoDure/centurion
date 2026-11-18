import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastMessage {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const VARIANTS: Record<ToastVariant, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  info: 'border-slate-200 bg-white text-slate-900',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const counter = useRef(0);

  const toast = useCallback((input: ToastInput) => {
    counter.current += 1;
    const id = counter.current;
    const message: ToastMessage = {
      id,
      title: input.title,
      variant: input.variant ?? 'info',
      ...(input.description !== undefined ? { description: input.description } : {}),
    };
    setMessages((current) => [...current, message]);
    window.setTimeout(() => {
      setMessages((current) => current.filter((entry) => entry.id !== id));
    }, 5000);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            role="status"
            className={cn(
              'pointer-events-auto rounded-lg border px-4 py-3 shadow-lg',
              VARIANTS[message.variant],
            )}
          >
            <p className="text-sm font-semibold">{message.title}</p>
            {message.description !== undefined && (
              <p className="mt-0.5 text-xs opacity-80">{message.description}</p>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
