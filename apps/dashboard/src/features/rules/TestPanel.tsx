import { logEnvelopeSchema, ruleTestRequestSchema } from '@centurion/contracts';
import type { JevQuestion, RuleTestResponse, UncertainPolicy } from '@centurion/contracts';
import { useState } from 'react';

import { errorMessage } from '../../api/client';
import { AnswerView } from '../../components/answer/AnswerView';
import { Badge } from '../../components/ui/Badge';
import type { BadgeVariant } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Textarea';
import { useTestRule } from '../../hooks/useRules';
import type { ConditionDraft } from '../../types/rule-form';

const VERDICT_VARIANTS: Record<RuleTestResponse['verdict'], BadgeVariant> = {
  TRIGGERED: 'danger',
  UNCERTAIN: 'warning',
  NOT_TRIGGERED: 'success',
};

const DEFAULT_SAMPLE = `{
  "schemaVersion": 1,
  "id": "sample-0001",
  "source": { "id": "checkout-service", "environment": "production" },
  "timestamp": "2026-09-30T12:00:00.000Z",
  "level": "error",
  "payload": "Payment failed with code card_declined; the customer could not complete checkout."
}`;

export interface TestPanelProps {
  question: JevQuestion;
  condition: ConditionDraft;
  uncertainPolicy: UncertainPolicy;
}

export function TestPanel({ question, condition, uncertainPolicy }: TestPanelProps) {
  const testRule = useTestRule();
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RuleTestResponse | null>(null);

  const run = async () => {
    setError(null);
    let json: unknown;
    try {
      json = JSON.parse(sample) as unknown;
    } catch {
      setError('The sample is not valid JSON.');
      return;
    }
    const envelope = logEnvelopeSchema.safeParse(json);
    if (!envelope.success) {
      setError(
        'The sample does not match the log envelope schema (schemaVersion, id, source, timestamp, payload).',
      );
      return;
    }
    const request = ruleTestRequestSchema.safeParse({
      question,
      condition,
      uncertainPolicy,
      sample: envelope.data,
    });
    if (!request.success) {
      setError('The rule is not valid yet. Fix the form before running a test.');
      return;
    }
    try {
      setResult(await testRule.mutateAsync(request.data));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <div className="space-y-4">
      <Textarea
        label="Sample log envelope"
        rows={8}
        value={sample}
        onChange={(event) => setSample(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void run()} loading={testRule.isPending}>
          Run test
        </Button>
        <span className="text-xs text-slate-500">Dry run against POST /api/v1/rules/test</span>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {result !== null && (
        <div
          data-testid="rule-test-result"
          className="space-y-3 rounded-lg border border-slate-200 bg-white p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-700">Verdict</span>
            <Badge variant={VERDICT_VARIANTS[result.verdict]}>{result.verdict}</Badge>
            <span className="text-xs text-slate-500">model {result.model}</span>
          </div>
          <AnswerView answer={result.answer} />
          <p className="text-xs text-slate-500">
            Tokens: {result.usage.inputTokens} in / {result.usage.outputTokens} out
          </p>
        </div>
      )}
    </div>
  );
}
