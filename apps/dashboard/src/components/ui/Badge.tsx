import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
};

export interface BadgeProps {
  variant?: BadgeVariant;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Badge({ variant = 'neutral', title, children, className }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
