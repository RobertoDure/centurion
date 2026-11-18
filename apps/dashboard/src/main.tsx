import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';

async function enableMocking(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_MSW === 'false') return;
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root was not found');
}

const root = createRoot(container);

void enableMocking().then(() => {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
