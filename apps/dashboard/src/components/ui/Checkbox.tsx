import { useId } from 'react';
import type { ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  label: string;
  description?: string;
}

export function Checkbox({ label, description, id, className, ref, ...rest }: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label
      htmlFor={inputId}
      className={cn('flex items-start gap-2 text-sm text-slate-700', className)}
    >
      <input
        id={inputId}
        ref={ref}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
        {...rest}
      />
      <span>
        <span className="font-medium text-slate-800">{label}</span>
        {description !== undefined && (
          <span className="block text-xs text-slate-500">{description}</span>
        )}
      </span>
    </label>
  );
}
