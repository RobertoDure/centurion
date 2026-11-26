import type { JevAnswer } from '@centurion/contracts';

import { formatPercent } from '../../lib/format';
import { ProbabilitiesTable } from './ProbabilitiesTable';

/** Renders a typed Jev answer: noul, choice probabilities or score legend. */
export function AnswerView({ answer }: { answer: JevAnswer }) {
  if (answer.type === 'noul') {
    return (
      <p className="text-sm text-slate-700">
        Noul probability: <span className="font-semibold">{formatPercent(answer.noul, 1)}</span>
      </p>
    );
  }
  if (answer.type === 'choice') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-700">
          Choice: <span className="font-semibold">{answer.choice}</span>
        </p>
        <p className="text-xs text-slate-500">Confidence: {formatPercent(answer.confidence, 1)}</p>
        <ProbabilitiesTable probabilities={answer.probabilities} />
      </div>
    );
  }
  const legend: Record<string, string> = {};
  for (const [key, value] of Object.entries(answer.legend)) {
    legend[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-700">
        Score: <span className="font-semibold">{answer.score.toFixed(2)}</span>
      </p>
      <p className="text-xs text-slate-500">Confidence: {formatPercent(answer.confidence, 1)}</p>
      <ProbabilitiesTable probabilities={answer.probabilities} legend={legend} />
    </div>
  );
}
