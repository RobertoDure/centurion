import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../test/render';
import { FlagsPage } from './FlagsPage';

describe('FlagsPage', () => {
  it('filters by source, outcome and rule', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FlagsPage />);

    expect(await screen.findByText('m-0001')).toBeTruthy();
    expect(screen.getByText('m-0002')).toBeTruthy();
    expect(screen.getByText('m-0003')).toBeTruthy();

    await user.type(screen.getByLabelText('Source'), 'checkout-service');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(screen.queryByText('m-0002')).toBeNull());
    expect(screen.getByText('m-0001')).toBeTruthy();
    expect(screen.queryByText('m-0003')).toBeNull();

    await user.clear(screen.getByLabelText('Source'));
    await user.selectOptions(screen.getByLabelText('Outcome'), 'uncertain');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(screen.queryByText('m-0001')).toBeNull());
    expect(screen.getByText('m-0002')).toBeTruthy();
    expect(screen.queryByText('m-0003')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Outcome'), '');
    await user.selectOptions(
      screen.getByLabelText('Rule'),
      '33333333-3333-4333-8333-333333333333',
    );
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(screen.queryByText('m-0003')).toBeNull());
    expect(screen.getByText('m-0002')).toBeTruthy();
    expect(screen.queryByText('m-0001')).toBeNull();
  });

  it('filters by a time window', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FlagsPage />);
    expect(await screen.findByText('m-0001')).toBeTruthy();

    // A window entirely after the seeded flags (2026-09-30) must return nothing.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-01-01T00:00' } });
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() =>
      expect(screen.getByText('No flags match these filters.')).toBeTruthy(),
    );
    expect(screen.queryByText('m-0001')).toBeNull();
  });

  it('shows answer details and action execution status', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FlagsPage />);

    const buttons = await screen.findAllByRole('button', { name: 'Details' });
    const [first] = buttons;
    if (first === undefined) throw new Error('no details buttons rendered');
    await user.click(first);

    const drawer = await screen.findByRole('dialog', { name: 'Flag details' });
    expect(within(drawer).getByText('Answer')).toBeTruthy();
    expect(within(drawer).getByText('91.0%')).toBeTruthy();
    expect(within(drawer).getByText('v3')).toBeTruthy();
    expect(await within(drawer).findByText('succeeded')).toBeTruthy();
  });

  it('renders an invalid marker without crashing', async () => {
    renderWithProviders(<FlagsPage />);
    expect(await screen.findByText(/unrecognised primitive/)).toBeTruthy();
  });
});
