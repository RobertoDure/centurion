import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../mocks/server';
import { renderWithProviders } from '../test/render';
import { SystemStatusPage } from './SystemStatusPage';

describe('SystemStatusPage', () => {
  it('shows lag, Jev error rate and DLQ count from /metrics', async () => {
    renderWithProviders(<SystemStatusPage />);

    await waitFor(() => expect(screen.getByTestId('consumer-lag').textContent).toBe('7'));
    expect(screen.getByTestId('jev-error-rate').textContent).toBe('1.53%');
    expect(screen.getByTestId('dlq-total').textContent).toBe('4');
  });

  it('surfaces a Jev auth problem prominently', async () => {
    server.use(
      http.get('/api/v1/ready', () =>
        HttpResponse.json(
          {
            status: 'not_ready',
            checks: [
              { name: 'database', ok: true },
              { name: 'kafka', ok: true },
              { name: 'jev_auth', ok: false, detail: '401 invalid API key' },
            ],
          },
          { status: 503 },
        ),
      ),
    );
    renderWithProviders(<SystemStatusPage />);

    const banner = await screen.findByTestId('auth-problem');
    expect(within(banner).getByText(/401 invalid API key/)).toBeTruthy();
    expect(screen.getByTestId('not-ready')).toBeTruthy();
  });
});
