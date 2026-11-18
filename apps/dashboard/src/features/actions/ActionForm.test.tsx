import type { ActionDto } from '@centurion/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { actionsApi } from '../../api/actions';
import { db } from '../../mocks/db';
import { renderWithProviders } from '../../test/render';
import { ActionForm } from './ActionForm';

function webhookAction(): ActionDto {
  const action = db.actions.find((entry) => entry.type === 'webhook');
  if (action === undefined) throw new Error('webhook seed missing');
  return action;
}

describe('ActionForm', () => {
  it('shows configured for a stored secret and never renders the secret back', () => {
    const action = webhookAction();
    renderWithProviders(
      <ActionForm initialAction={action} actionId={action.id} onSaved={() => undefined} />,
    );

    expect(screen.getByText('configured')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Secret').value).toBe('');
  });

  it('omits the secret when editing without replacing it', async () => {
    const action = webhookAction();
    const updateSpy = vi.spyOn(actionsApi, 'update').mockResolvedValue(action);
    const user = userEvent.setup();
    renderWithProviders(
      <ActionForm initialAction={action} actionId={action.id} onSaved={() => undefined} />,
    );

    await user.click(screen.getByRole('button', { name: /save action/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const content = updateSpy.mock.calls[0]?.[1];
    expect(content?.type).toBe('webhook');
    expect(content?.config).not.toHaveProperty('secret');
  });

  it('sends a new secret when creating a webhook', async () => {
    const createSpy = vi.spyOn(actionsApi, 'create').mockResolvedValue(webhookAction());
    const user = userEvent.setup();
    renderWithProviders(<ActionForm onSaved={() => undefined} />);

    await user.type(screen.getByLabelText('Name'), 'New webhook');
    await user.type(screen.getByLabelText('URL'), 'https://example.com/hook');
    await user.type(screen.getByLabelText('Secret'), 's3cret');
    await user.click(screen.getByRole('button', { name: /save action/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const content = createSpy.mock.calls[0]?.[0];
    expect(content?.type).toBe('webhook');
    if (content?.type === 'webhook') {
      expect(content.config.secret).toBe('s3cret');
    }
  });
});
