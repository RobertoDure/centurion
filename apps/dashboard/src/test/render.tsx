import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { ToastProvider } from '../components/ui/Toast';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
}

export interface TestProvidersProps {
  children: ReactNode;
  initialEntries?: string[];
}

export function TestProviders({ children, initialEntries = ['/'] }: TestProvidersProps) {
  const [queryClient] = useState(createTestQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options: { initialEntries?: string[] } = {},
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <TestProviders initialEntries={options.initialEntries}>{children}</TestProviders>
    ),
  });
}
