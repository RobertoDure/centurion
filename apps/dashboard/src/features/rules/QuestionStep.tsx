import {
  CHOICE_MAX_OPTIONS,
  CHOICE_MIN_OPTIONS,
  SCORE_MAX_LEVELS,
  SCORE_MIN_LEVELS,
} from '@centurion/contracts';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { cn } from '../../lib/cn';
import {
  addChoiceOption,
  addScoreLevel,
  createQuestion,
  moveScoreLevel,
  removeChoiceOption,
  removeScoreLevel,
  setChoiceOptionDescription,
  setChoiceOptionKey,
  setScoreLevel,
  withInstructions,
  withNoulCriteria,
} from '../../lib/rule-drafts';
import type {
  ChoiceQuestionForm,
  NoulQuestionForm,
  QuestionForm,
  ScoreQuestionForm,
} from '../../types/rule-form';

export interface QuestionStepProps {
  value: QuestionForm;
  onChange: (question: QuestionForm) => void;
}

const QUESTION_TYPES = [
  { value: 'noul', label: 'Noul' },
  { value: 'choice', label: 'Choice' },
  { value: 'score', label: 'Score' },
] as const;

export function QuestionStep({ value, onChange }: QuestionStepProps) {
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Question type" className="flex flex-wrap gap-2">
        {QUESTION_TYPES.map((option) => (
          <label
            key={option.value}
            className={cn(
              'inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium',
              value.type === option.value
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700',
            )}
          >
            <input
              type="radio"
              name="question-type"
              className="sr-only"
              checked={value.type === option.value}
              onChange={() => onChange(createQuestion(option.value))}
            />
            {option.label}
          </label>
        ))}
      </div>

      <Textarea
        label="Instructions"
        value={value.instructions}
        onChange={(event) => onChange(withInstructions(value, event.target.value))}
        hint="One judgment, stated literally. Do not ask Jev to count, add, or compare numbers or dates."
      />

      {value.type === 'noul' && <NoulBuilder question={value} onChange={onChange} />}
      {value.type === 'choice' && <ChoiceBuilder question={value} onChange={onChange} />}
      {value.type === 'score' && <ScoreBuilder question={value} onChange={onChange} />}
    </div>
  );
}

function NoulBuilder({
  question,
  onChange,
}: {
  question: NoulQuestionForm;
  onChange: (question: QuestionForm) => void;
}) {
  return (
    <div className="space-y-3">
      <Textarea
        label="Criteria: true means"
        value={question.criteria?.true ?? ''}
        onChange={(event) => onChange(withNoulCriteria(question, 'true', event.target.value))}
      />
      <Textarea
        label="Criteria: false means"
        value={question.criteria?.false ?? ''}
        onChange={(event) => onChange(withNoulCriteria(question, 'false', event.target.value))}
      />
    </div>
  );
}

function ChoiceBuilder({
  question,
  onChange,
}: {
  question: ChoiceQuestionForm;
  onChange: (question: QuestionForm) => void;
}) {
  const entries = Object.entries(question.criteria);
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {entries.length} of {CHOICE_MAX_OPTIONS} options (minimum {CHOICE_MIN_OPTIONS}). Option names are
        the answers the model chooses from.
      </p>
      {entries.map(([key, description], index) => (
        <div key={index} className="flex items-end gap-2">
          <Input
            label="Option"
            className="max-w-48"
            value={key}
            onChange={(event) => onChange(setChoiceOptionKey(question, index, event.target.value))}
          />
          <Input
            label="Description"
            className="flex-1"
            value={description ?? ''}
            onChange={(event) =>
              onChange(setChoiceOptionDescription(question, index, event.target.value))
            }
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={entries.length <= CHOICE_MIN_OPTIONS}
            aria-label={`Remove option ${key}`}
            onClick={() => onChange(removeChoiceOption(question, index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        disabled={entries.length >= CHOICE_MAX_OPTIONS}
        onClick={() => onChange(addChoiceOption(question))}
      >
        Add option
      </Button>
    </div>
  );
}

function ScoreBuilder({
  question,
  onChange,
}: {
  question: ScoreQuestionForm;
  onChange: (question: QuestionForm) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {question.criteria.length} levels ({SCORE_MIN_LEVELS}-{SCORE_MAX_LEVELS}), ordered low to high.
        Only threshold on the score; do not read it as a magnitude.
      </p>
      {question.criteria.map((level, index) => (
        <div key={index} className="flex items-end gap-2">
          <span className="w-5 pb-2 text-right text-xs text-slate-500">{index}</span>
          <Input
            label={`Level ${index}`}
            className="flex-1"
            value={level}
            onChange={(event) => onChange(setScoreLevel(question, index, event.target.value))}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={index === 0}
            aria-label={`Move level ${index} up`}
            onClick={() => onChange(moveScoreLevel(question, index, -1))}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={index === question.criteria.length - 1}
            aria-label={`Move level ${index} down`}
            onClick={() => onChange(moveScoreLevel(question, index, 1))}
          >
            ↓
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={question.criteria.length <= SCORE_MIN_LEVELS}
            aria-label={`Remove level ${index}`}
            onClick={() => onChange(removeScoreLevel(question, index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        disabled={question.criteria.length >= SCORE_MAX_LEVELS}
        onClick={() => onChange(addScoreLevel(question))}
      >
        Add level
      </Button>
    </div>
  );
}
