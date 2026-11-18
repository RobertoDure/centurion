import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../test/render';
import { ActionsPage } from './ActionsPage';

describe('ActionsPage', () => {
  it('shows the secret state and the last execution status per action', async () => {
    renderWithProviders(<ActionsPage />);

    expect(await screen.findByText('Ops webhook')).toBeTruthy();
    expect(screen.getByText('Publish to logs.flags')).toBeTruthy();

    // The webhook reports a configured secret; the kafka action never has one.
    expect(screen.getByText('configured')).toBeTruthy();
    expect(screen.queryByText('not set')).toBeNull();

    // Last executions come from GET /api/v1/actions/:id/executions.
    expect(await screen.findByText('succeeded')).toBeTruthy();
    expect(await screen.findByText('failed')).toBeTruthy();
  });
});
