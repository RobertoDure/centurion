import { useId } from 'react';
import type { ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn';

export interface InputProps extends ComponentPropsWithRef<'input'> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, id, className, ref, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy =
    error !== undefined ? `${inputId}-error` : hint !== undefined ? `${inputId}-hint` : undefined;
  return (
    <div className="space-y-1">
      {label !== undefined && (
        <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <input
        id={inputId}
        ref={ref}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy}
        className={cn(
          'block w-full rounded-md border-0 px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-slate-900 disabled:bg-slate-100',
          error !== undefined && 'ring-red-500 focus:ring-red-500',
          className,
        )}
        {...rest}
      />
      {hint !== undefined && (
        <p id={`${inputId}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
