import type { RuleDto } from '@centurion/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { rulesApi } from '../api/rules';
import { db } from '../mocks/db';
import { renderWithProviders } from '../test/render';
import { RulesListPage } from './RulesListPage';

function firstRule(): RuleDto {
  const rule = db.rules[0];
  if (rule === undefined) throw new Error('rule seed missing');
  return rule;
}

describe('RulesListPage', () => {
  it('renders the seeded rules with invalid and auto-disabled badges', async () => {
    renderWithProviders(<RulesListPage />);

    expect(await screen.findByText('Payment failure needs follow-up')).toBeTruthy();
    expect(screen.getByText('Support request intent')).toBeTruthy();
    expect(screen.getByText('Customer frustration score')).toBeTruthy();
    expect(screen.getByText('invalid')).toBeTruthy();
    expect(screen.getByText('auto-disabled')).toBeTruthy();
  });

  it('disables an enabled rule through the toggle', async () => {
    const rule = firstRule();
    const disableSpy = vi.spyOn(rulesApi, 'disable').mockResolvedValue(rule);
    const user = userEvent.setup();
    renderWithProviders(<RulesListPage />);

    const toggle = await screen.findByRole('checkbox', {
      name: /disable payment failure needs follow-up/i,
    });
    await user.click(toggle);

    await waitFor(() => expect(disableSpy).toHaveBeenCalledWith(rule.id));
  });

  it('opens the version history drawer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RulesListPage />);

    const buttons = await screen.findAllByRole('button', { name: 'Versions' });
    const [firstButton] = buttons;
    if (firstButton === undefined) throw new Error('no version buttons rendered');
    await user.click(firstButton);

    const drawer = await screen.findByRole('dialog', { name: 'Version history' });
    expect(within(drawer).getByText('v3')).toBeTruthy();
    expect(within(drawer).getByText('v2')).toBeTruthy();
    expect(within(drawer).getByText('v1')).toBeTruthy();
  });
});
