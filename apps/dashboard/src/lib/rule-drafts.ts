import type { Description, JevQuestion, RuleDto } from '@centurion/contracts';

import type {
  ChoiceCondition,
  ChoiceQuestionForm,
  ConditionDraft,
  NoulConditionDraft,
  NoulQuestionForm,
  QuestionForm,
  RuleFormValues,
  ScoreCondition,
  ScoreQuestionForm,
} from '../types/rule-form';

export const CHOICE_DEFAULT_PREFIX = 'option_';
export const SCORE_DEFAULT_LEVEL = '';

export function descriptionToString(value: Description | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function createNoulQuestion(): NoulQuestionForm {
  return { type: 'noul', instructions: '', criteria: {} };
}

function createChoiceQuestion(): ChoiceQuestionForm {
  return { type: 'choice', instructions: '', criteria: { option_1: null, option_2: null } };
}

function createScoreQuestion(): ScoreQuestionForm {
  return { type: 'score', instructions: '', criteria: ['Level 1', 'Level 2'] };
}

export function createQuestion(type: QuestionForm['type']): QuestionForm {
  switch (type) {
    case 'noul':
      return createNoulQuestion();
    case 'choice':
      return createChoiceQuestion();
    case 'score':
      return createScoreQuestion();
  }
}

export function createNoulCondition(): NoulConditionDraft {
  return { type: 'noul', op: 'gte', threshold: 0.5 };
}

export function createChoiceCondition(): ChoiceCondition {
  return { type: 'choice', anyOf: ['option_1'] };
}

export function createScoreCondition(): ScoreCondition {
  return { type: 'score', op: 'gte', threshold: 1 };
}

/** A fresh, internally consistent condition for the given primitive. */
export function createCondition(type: QuestionForm['type']): ConditionDraft {
  switch (type) {
    case 'noul':
      return createNoulCondition();
    case 'choice':
      return createChoiceCondition();
    case 'score':
      return createScoreCondition();
  }
}

export function emptyRuleFormValues(): RuleFormValues {
  return {
    name: '',
    description: '',
    enabled: true,
    scope: {},
    question: createQuestion('noul'),
    condition: createCondition('noul'),
    uncertainPolicy: 'ignore',
    actionIds: [],
  };
}

function questionToFormValues(question: JevQuestion): QuestionForm {
  switch (question.type) {
    case 'noul':
      return {
        type: 'noul',
        instructions: descriptionToString(question.instructions),
        criteria: {
          true: descriptionToString(question.criteria?.true),
          false: descriptionToString(question.criteria?.false),
        },
      };
    case 'choice': {
      const criteria: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(question.criteria)) {
        criteria[key] = value === null ? null : descriptionToString(value);
      }
      return { type: 'choice', instructions: descriptionToString(question.instructions), criteria };
    }
    case 'score':
      return {
        type: 'score',
        instructions: descriptionToString(question.instructions),
        criteria: question.criteria.map((level) => descriptionToString(level)),
      };
  }
}

export function ruleToFormValues(rule: RuleDto): RuleFormValues {
  return {
    name: rule.name,
    description: rule.description ?? '',
    enabled: rule.enabled,
    scope: rule.scope,
    question: questionToFormValues(rule.question),
    condition: rule.condition,
    uncertainPolicy: rule.uncertainPolicy,
    actionIds: rule.actionIds,
  };
}

export function withInstructions(question: QuestionForm, instructions: string): QuestionForm {
  switch (question.type) {
    case 'noul':
      return { ...question, instructions };
    case 'choice':
      return { ...question, instructions };
    case 'score':
      return { ...question, instructions };
  }
}

export function withNoulCriteria(
  question: NoulQuestionForm,
  key: 'true' | 'false',
  value: string,
): NoulQuestionForm {
  const current = question.criteria ?? {};
  return { ...question, criteria: { ...current, [key]: value } };
}

export function choiceOptionKeys(question: ChoiceQuestionForm): string[] {
  return Object.keys(question.criteria);
}

function nextOptionKey(criteria: Record<string, string | null>): string {
  let index = Object.keys(criteria).length + 1;
  while (Object.prototype.hasOwnProperty.call(criteria, `${CHOICE_DEFAULT_PREFIX}${index}`)) {
    index += 1;
  }
  return `${CHOICE_DEFAULT_PREFIX}${index}`;
}

export function addChoiceOption(question: ChoiceQuestionForm): ChoiceQuestionForm {
  const key = nextOptionKey(question.criteria);
  return { ...question, criteria: { ...question.criteria, [key]: null } };
}

export function removeChoiceOption(question: ChoiceQuestionForm, index: number): ChoiceQuestionForm {
  const entries = Object.entries(question.criteria);
  const next: Record<string, string | null> = {};
  entries.forEach(([key, value], entryIndex) => {
    if (entryIndex !== index) next[key] = value;
  });
  return { ...question, criteria: next };
}

export function setChoiceOptionKey(
  question: ChoiceQuestionForm,
  index: number,
  key: string,
): ChoiceQuestionForm {
  const entries = Object.entries(question.criteria);
  const next: Record<string, string | null> = {};
  entries.forEach(([existingKey, value], entryIndex) => {
    next[entryIndex === index ? key : existingKey] = value;
  });
  return { ...question, criteria: next };
}

export function setChoiceOptionDescription(
  question: ChoiceQuestionForm,
  index: number,
  description: string,
): ChoiceQuestionForm {
  const entries = Object.entries(question.criteria);
  const next: Record<string, string | null> = {};
  entries.forEach(([key, value], entryIndex) => {
    next[key] = entryIndex === index ? (description === '' ? null : description) : value;
  });
  return { ...question, criteria: next };
}

export function addScoreLevel(question: ScoreQuestionForm): ScoreQuestionForm {
  return { ...question, criteria: [...question.criteria, SCORE_DEFAULT_LEVEL] };
}

export function removeScoreLevel(question: ScoreQuestionForm, index: number): ScoreQuestionForm {
  return { ...question, criteria: question.criteria.filter((_, i) => i !== index) };
}

export function setScoreLevel(
  question: ScoreQuestionForm,
  index: number,
  value: string,
): ScoreQuestionForm {
  return {
    ...question,
    criteria: question.criteria.map((level, i) => (i === index ? value : level)),
  };
}

export function moveScoreLevel(
  question: ScoreQuestionForm,
  index: number,
  direction: -1 | 1,
): ScoreQuestionForm {
  const target = index + direction;
  if (target < 0 || target >= question.criteria.length) return question;
  const criteria = [...question.criteria];
  const current = criteria[index];
  const swap = criteria[target];
  if (current === undefined || swap === undefined) return question;
  criteria[index] = swap;
  criteria[target] = current;
  return { ...question, criteria };
}
