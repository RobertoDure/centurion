import { zodResolver } from '@hookform/resolvers/zod';
import { ruleContentSchema } from '@centurion/contracts';
import type { RuleContent, RuleDto } from '@centurion/contracts';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';

import { isValidAction } from '../../api/actions';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { useToast } from '../../components/ui/Toast';
import { useActions } from '../../hooks/useActions';
import { useCreateRule, useUpdateRule } from '../../hooks/useRules';
import { cn } from '../../lib/cn';
import { collectErrorMessages } from '../../lib/form-errors';
import { createCondition, emptyRuleFormValues } from '../../lib/rule-drafts';
import type { RuleFormValues } from '../../types/rule-form';
import { ActionsStep } from './ActionsStep';
import { ConditionStep } from './ConditionStep';
import { QuestionStep } from './QuestionStep';
import { RuleAuthoringGuidance } from './RuleAuthoringGuidance';
import { ScopeStep } from './ScopeStep';
import { TestPanel } from './TestPanel';

export interface RuleEditorFormProps {
  initialValues?: RuleFormValues;
  ruleId?: string;
  onSaved?: (rule: RuleDto) => void;
}

const STEPS = ['Scope', 'Question', 'Condition', 'Actions', 'Test'] as const;

/**
 * The shared schema validates the form, but zod types the recursive Description
 * input as `unknown`; bridge that to the concrete form value type here.
 */
const ruleFormResolver = zodResolver(ruleContentSchema) as unknown as Resolver<
  RuleFormValues,
  unknown,
  RuleContent
>;

export function RuleEditorForm({ initialValues, ruleId, onSaved }: RuleEditorFormProps) {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const { toast } = useToast();
  const actionsQuery = useActions();
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();

  const form = useForm<RuleFormValues, unknown, RuleContent>({
    resolver: ruleFormResolver,
    defaultValues: initialValues ?? emptyRuleFormValues(),
    mode: 'onTouched',
  });

  const question = form.watch('question');
  const condition = form.watch('condition');
  const scope = form.watch('scope');
  const actionIds = form.watch('actionIds');
  const uncertainPolicy = form.watch('uncertainPolicy');
  const errorMessages = Array.from(new Set(collectErrorMessages(form.formState.errors)));

  const handleQuestionChange = (next: typeof question) => {
    const previous = form.getValues('question');
    form.setValue('question', next, { shouldDirty: true, shouldValidate: true });
    if (previous.type !== next.type) {
      form.setValue('condition', createCondition(next.type), {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  };

  const onSubmit = form.handleSubmit(async (ruleContent) => {
    try {
      const saved =
        ruleId !== undefined
          ? await updateRule.mutateAsync({ id: ruleId, content: ruleContent })
          : await createRule.mutateAsync(ruleContent);
      toast({ title: 'Rule saved', variant: 'success' });
      if (onSaved !== undefined) {
        onSaved(saved);
      } else {
        navigate('/');
      }
    } catch (caught) {
      toast({
        title: 'Could not save rule',
        description: errorMessage(caught),
        variant: 'error',
      });
    }
  });

  const isSaving = createRule.isPending || updateRule.isPending;
  const errors = form.formState.errors;

  return (
    <form className="space-y-5" onSubmit={onSubmit} noValidate>
      {errorMessages.length > 0 && (
        <div
          role="alert"
          data-testid="rule-form-errors"
          className="rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="text-sm font-semibold text-red-900">This rule cannot be saved yet:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-red-800">
            {errorMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Name"
          placeholder="Payment failure needs follow-up"
          {...form.register('name')}
          error={errors.name?.message}
        />
        <div className="flex items-end pb-1">
          <Controller
            control={form.control}
            name="enabled"
            render={({ field }) => (
              <Checkbox
                label="Enabled"
                checked={field.value}
                onChange={(event) => field.onChange(event.target.checked)}
              />
            )}
          />
        </div>
      </div>
      <Textarea label="Description (optional)" rows={2} {...form.register('description')} />

      <nav aria-label="Form steps" className="flex flex-wrap gap-2">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(index)}
            aria-current={step === index ? 'step' : undefined}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset',
              step === index
                ? 'bg-slate-900 text-white ring-slate-900'
                : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-100',
            )}
          >
            {index + 1}. {label}
          </button>
        ))}
      </nav>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        {step === 0 && (
          <ScopeStep
            value={scope ?? {}}
            onChange={(next) => form.setValue('scope', next, { shouldDirty: true, shouldValidate: true })}
          />
        )}
        {step === 1 && (
          <div className="space-y-4">
            <RuleAuthoringGuidance />
            <QuestionStep value={question} onChange={handleQuestionChange} />
          </div>
        )}
        {step === 2 && (
          <ConditionStep
            question={question}
            value={condition}
            onChange={(next) =>
              form.setValue('condition', next, { shouldDirty: true, shouldValidate: true })
            }
          />
        )}
        {step === 3 && (
          <ActionsStep
            actionIds={actionIds ?? []}
            onChange={(next) =>
              form.setValue('actionIds', next, { shouldDirty: true, shouldValidate: true })
            }
            actions={(actionsQuery.data?.items ?? []).filter(isValidAction)}
            uncertainPolicy={uncertainPolicy ?? 'ignore'}
            onUncertainPolicyChange={(next) =>
              form.setValue('uncertainPolicy', next, { shouldDirty: true, shouldValidate: true })
            }
          />
        )}
        {step === 4 && (
          <div className="space-y-3">
            <TestPanel
              question={question}
              condition={condition}
              uncertainPolicy={uncertainPolicy ?? 'ignore'}
            />
            <p className="text-xs text-slate-500">
              Saving validates the whole rule against the shared contracts schema.
            </p>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          disabled={step === 0}
        >
          Back
        </Button>
        <div className="flex gap-2">
          {step < STEPS.length - 1 && (
            <Button
              variant="secondary"
              onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
            >
              Next
            </Button>
          )}
          <Button type="submit" loading={isSaving}>
            Save rule
          </Button>
        </div>
      </div>
    </form>
  );
}
