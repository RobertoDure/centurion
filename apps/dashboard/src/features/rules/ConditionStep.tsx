import type { RuleOp } from '@centurion/contracts';

import { Checkbox } from '../../components/ui/Checkbox';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { choiceOptionKeys } from '../../lib/rule-drafts';
import type {
  ChoiceCondition,
  ChoiceQuestionForm,
  ConditionDraft,
  NoulConditionDraft,
  NoulQuestionForm,
  QuestionForm,
  ScoreCondition,
  ScoreQuestionForm,
} from '../../types/rule-form';

export interface ConditionStepProps {
  question: QuestionForm;
  value: ConditionDraft;
  onChange: (condition: ConditionDraft) => void;
}

const OP_OPTIONS = [
  { value: 'gte', label: 'greater than or equal (≥)' },
  { value: 'lte', label: 'less than or equal (≤)' },
];

function toRuleOp(value: string): RuleOp {
  return value === 'gte' ? 'gte' : 'lte';
}

export function ConditionStep({ question, value, onChange }: ConditionStepProps) {
  switch (question.type) {
    case 'noul': {
      if (value.type !== 'noul') return <ConditionMismatch />;
      return <NoulConditionFields question={question} condition={value} onChange={onChange} />;
    }
    case 'choice': {
      if (value.type !== 'choice') return <ConditionMismatch />;
      return <ChoiceConditionFields question={question} condition={value} onChange={onChange} />;
    }
    case 'score': {
      if (value.type !== 'score') return <ConditionMismatch />;
      return <ScoreConditionFields question={question} condition={value} onChange={onChange} />;
    }
  }
}

function ConditionMismatch() {
  return (
    <p role="alert" className="text-sm text-red-600">
      The condition type no longer matches the question type. Change the question type to reset it.
    </p>
  );
}

function NoulConditionFields({
  question,
  condition,
  onChange,
}: {
  question: NoulQuestionForm;
  condition: NoulConditionDraft;
  onChange: (condition: ConditionDraft) => void;
}) {
  return (
    <div className="space-y-3">
      <Select
        label="Operator"
        value={condition.op}
        options={OP_OPTIONS}
        onChange={(event) => onChange({ ...condition, op: toRuleOp(event.target.value) })}
      />
      <Input
        label="Threshold (0 to 1)"
        type="number"
        min={0}
        max={1}
        step={0.05}
        value={condition.threshold}
        onChange={(event) => onChange({ ...condition, threshold: Number(event.target.value) })}
      />
      <p className="text-xs text-slate-500">
        Noul has no confidence value, so there is no minimum confidence here.
        {question.instructions !== ''
          ? ' Thresholds tuned for Choice or Score do not transfer to Noul.'
          : ''}
      </p>
    </div>
  );
}

function ChoiceConditionFields({
  question,
  condition,
  onChange,
}: {
  question: ChoiceQuestionForm;
  condition: ChoiceCondition;
  onChange: (condition: ConditionDraft) => void;
}) {
  const options = choiceOptionKeys(question);
  const stale = condition.anyOf.filter((option) => !options.includes(option));

  const toggle = (option: string, checked: boolean) => {
    const next = checked
      ? [...condition.anyOf, option]
      : condition.anyOf.filter((entry) => entry !== option);
    onChange({ ...condition, anyOf: next });
  };

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Trigger when the answer is one of</legend>
        <div className="mt-2 space-y-1">
          {options.map((option) => (
            <Checkbox
              key={option}
              label={option}
              checked={condition.anyOf.includes(option)}
              onChange={(event) => toggle(option, event.target.checked)}
            />
          ))}
          {stale.map((option) => (
            <Checkbox
              key={`stale-${option}`}
              label={`${option} (no longer defined in the question)`}
              checked
              onChange={(event) => toggle(option, event.target.checked)}
            />
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Minimum probability (optional)"
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={condition.minProbability ?? ''}
          onChange={(event) =>
            onChange({
              ...condition,
              minProbability: event.target.value === '' ? undefined : Number(event.target.value),
            })
          }
        />
        <Input
          label="Minimum confidence (optional)"
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={condition.minConfidence ?? ''}
          onChange={(event) =>
            onChange({
              ...condition,
              minConfidence: event.target.value === '' ? undefined : Number(event.target.value),
            })
          }
        />
      </div>
    </div>
  );
}

function ScoreConditionFields({
  question,
  condition,
  onChange,
}: {
  question: ScoreQuestionForm;
  condition: ScoreCondition;
  onChange: (condition: ConditionDraft) => void;
}) {
  const topLevel = question.criteria.length - 1;
  return (
    <div className="space-y-3">
      <Select
        label="Operator"
        value={condition.op}
        options={OP_OPTIONS}
        onChange={(event) => onChange({ ...condition, op: toRuleOp(event.target.value) })}
      />
      <Input
        label={`Threshold (0 to ${topLevel})`}
        type="number"
        min={0}
        max={topLevel}
        step={1}
        value={condition.threshold}
        onChange={(event) => onChange({ ...condition, threshold: Number(event.target.value) })}
        hint={`The top level index is ${topLevel}.`}
      />
      <Input
        label="Minimum confidence (optional)"
        type="number"
        min={0}
        max={1}
        step={0.05}
        value={condition.minConfidence ?? ''}
        onChange={(event) =>
          onChange({
            ...condition,
            minConfidence: event.target.value === '' ? undefined : Number(event.target.value),
          })
        }
      />
    </div>
  );
}
