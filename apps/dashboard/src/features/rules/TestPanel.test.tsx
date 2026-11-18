import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render';
import { TestPanel } from './TestPanel';

describe('TestPanel', () => {
  it('renders the Noul answer and verdict', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <TestPanel
        question={{ type: 'noul', instructions: 'Is it bad?', criteria: {} }}
        condition={{ type: 'noul', op: 'gte', threshold: 0.5 }}
        uncertainPolicy="ignore"
      />,
    );

    await user.click(screen.getByRole('button', { name: /run test/i }));

    const result = await screen.findByTestId('rule-test-result');
    expect(result.textContent).toContain('TRIGGERED');
    expect(result.textContent).toContain('Noul probability');
    expect(result.textContent).toContain('86.0%');
  });

  it('renders Choice probabilities and confidence', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <TestPanel
        question={{
          type: 'choice',
          instructions: 'What is the intent?',
          criteria: { billing: 'Billing', technical: 'Technical', none: null },
        }}
        condition={{ type: 'choice', anyOf: ['billing'] }}
        uncertainPolicy="ignore"
      />,
    );

    await user.click(screen.getByRole('button', { name: /run test/i }));

    const result = await screen.findByTestId('rule-test-result');
    expect(result.textContent).toContain('TRIGGERED');
    expect(result.textContent).toContain('billing');
    expect(result.textContent).toContain('82.0%');
  });

  it('renders the Score legend, probabilities and confidence', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <TestPanel
        question={{ type: 'score', instructions: 'Rate it', criteria: ['Low', 'High'] }}
        condition={{ type: 'score', op: 'gte', threshold: 1 }}
        uncertainPolicy="ignore"
      />,
    );

    await user.click(screen.getByRole('button', { name: /run test/i }));

    const result = await screen.findByTestId('rule-test-result');
    expect(result.textContent).toContain('TRIGGERED');
    expect(result.textContent).toContain('High');
    expect(result.textContent).toContain('80.0%');
    expect(result.textContent).toContain('Confidence');
  });
});
