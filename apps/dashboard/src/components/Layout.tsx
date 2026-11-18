import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { cn } from '../lib/cn';

function NavItem({ to, end = false, children }: { to: string; end?: boolean; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'rounded-md px-3 py-1.5 text-sm font-medium transition',
          isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
        )
      }
    >
      {children}
    </NavLink>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <NavLink to="/" className="text-lg font-semibold tracking-tight text-slate-900">
            Centurion
          </NavLink>
          <nav aria-label="Main" className="flex items-center gap-1">
            <NavItem to="/" end>
              Rules
            </NavItem>
            <NavItem to="/actions">Actions</NavItem>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
