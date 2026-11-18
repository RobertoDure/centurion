import { useId } from 'react';
import type { ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn';

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Textarea({
  label,
  error,
  hint,
  id,
  className,
  rows = 3,
  ref,
  ...rest
}: TextareaProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className="space-y-1">
      {label !== undefined && (
        <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        ref={ref}
        rows={rows}
        aria-invalid={error !== undefined || undefined}
        className={cn(
          'block w-full rounded-md border-0 px-3 py-2 font-mono text-xs text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-slate-900',
          error !== undefined && 'ring-red-500 focus:ring-red-500',
          className,
        )}
        {...rest}
      />
      {hint !== undefined && <p className="text-xs text-slate-500">{hint}</p>}
      {error !== undefined && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
