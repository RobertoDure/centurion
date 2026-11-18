import { useId } from 'react';
import type { ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'children'> {
  label?: string;
  error?: string;
  options: readonly SelectOption[];
}

export function Select({ label, error, options, id, className, ref, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <div className="space-y-1">
      {label !== undefined && (
        <label htmlFor={selectId} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <select
        id={selectId}
        ref={ref}
        aria-invalid={error !== undefined || undefined}
        className={cn(
          'block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-slate-900',
          error !== undefined && 'ring-red-500 focus:ring-red-500',
          className,
        )}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error !== undefined && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
