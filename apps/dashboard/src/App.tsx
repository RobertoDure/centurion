import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui/Toast';
import { ActionsPage } from './pages/ActionsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RuleEditorPage } from './pages/RuleEditorPage';
import { RulesListPage } from './pages/RulesListPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<RulesListPage />} />
                <Route path="rules/new" element={<RuleEditorPage />} />
                <Route path="rules/:id/edit" element={<RuleEditorPage />} />
                <Route path="actions" element={<ActionsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
