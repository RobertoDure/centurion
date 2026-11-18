import { ruleDtoSchema } from '@centurion/contracts';
import type { RuleDto } from '@centurion/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { rulesApi } from '../../api/rules';
import { renderWithProviders } from '../../test/render';
import type { RuleFormValues } from '../../types/rule-form';
import { RuleEditorForm } from './RuleEditorForm';

function sampleRule(): RuleDto {
  return ruleDtoSchema.parse({
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Saved rule',
    enabled: true,
    version: 1,
    scope: {},
    question: { type: 'noul', instructions: 'Is it bad?', criteria: {} },
    condition: { type: 'noul', op: 'gte', threshold: 0.5 },
    uncertainPolicy: 'ignore',
    actionIds: [],
    invalid: false,
  });
}

function baseValues(overrides: Partial<RuleFormValues>): RuleFormValues {
  return {
    name: 'Test rule',
    description: '',
    enabled: true,
    scope: {},
    question: { type: 'noul', instructions: 'Is it bad?', criteria: {} },
    condition: { type: 'noul', op: 'gte', threshold: 0.5 },
    uncertainPolicy: 'ignore',
    actionIds: [],
    ...overrides,
  };
}

async function save() {
  await userEvent.setup().click(screen.getByRole('button', { name: /save rule/i }));
}

describe('RuleEditorForm validation', () => {
  it('cannot submit a Choice condition that references a removed option', async () => {
    const createSpy = vi.spyOn(rulesApi, 'create').mockResolvedValue(sampleRule());
    renderWithProviders(
      <RuleEditorForm
        onSaved={() => undefined}
        initialValues={baseValues({
          question: {
            type: 'choice',
            instructions: 'What is the intent?',
            criteria: { alpha: 'Alpha', beta: 'Beta' },
          },
          condition: { type: 'choice', anyOf: ['alpha', 'ghost'] },
        })}
      />,
    );

    await save();

    expect((await screen.findByTestId('rule-form-errors')).textContent).toContain('ghost');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('cannot submit a Score threshold above the top level', async () => {
    const createSpy = vi.spyOn(rulesApi, 'create').mockResolvedValue(sampleRule());
    renderWithProviders(
      <RuleEditorForm
        onSaved={() => undefined}
        initialValues={baseValues({
          question: { type: 'score', instructions: 'Rate it', criteria: ['Low', 'High'] },
          condition: { type: 'score', op: 'gte', threshold: 5 },
        })}
      />,
    );

    await save();

    expect((await screen.findByTestId('rule-form-errors')).textContent).toContain(
      'above the top score level',
    );
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('cannot submit a Noul condition carrying minConfidence', async () => {
    const createSpy = vi.spyOn(rulesApi, 'create').mockResolvedValue(sampleRule());
    renderWithProviders(
      <RuleEditorForm
        onSaved={() => undefined}
        initialValues={baseValues({
          question: { type: 'noul', instructions: 'Is it bad?', criteria: {} },
          condition: { type: 'noul', op: 'gte', threshold: 0.5, minConfidence: 0.4 },
        })}
      />,
    );

    await save();

    expect((await screen.findByTestId('rule-form-errors')).textContent).toContain('minConfidence');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('resets the condition when the question type changes', async () => {
    const createSpy = vi.spyOn(rulesApi, 'create').mockResolvedValue(sampleRule());
    const user = userEvent.setup();
    renderWithProviders(
      <RuleEditorForm
        onSaved={() => undefined}
        initialValues={baseValues({
          name: 'Choice rule',
          question: {
            type: 'choice',
            instructions: 'What is the intent?',
            criteria: { alpha: 'Alpha', beta: 'Beta' },
          },
          condition: { type: 'choice', anyOf: ['alpha'], minProbability: 0.6, minConfidence: 0.5 },
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /2\. Question/ }));
    await user.click(screen.getByRole('radio', { name: 'Noul' }));
    await user.click(screen.getByRole('button', { name: /save rule/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const content = createSpy.mock.calls[0]?.[0];
    expect(content?.condition).toEqual({ type: 'noul', op: 'gte', threshold: 0.5 });
    expect(content?.condition).not.toHaveProperty('minConfidence');
  });
});
