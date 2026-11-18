import type { HTMLAttributes, ReactNode, ThHTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className={cn('min-w-full divide-y divide-slate-200 text-left text-sm', className)}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="bg-slate-50">{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}

export function TableRow({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn('align-top', className)}>{children}</tr>;
}

export function TableHeaderCell({ children, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500', className)}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TableCell({ children, className, ...rest }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-3 text-slate-700', className)} {...rest}>
      {children}
    </td>
  );
}
