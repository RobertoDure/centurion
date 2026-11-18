const TIPS: readonly string[] = [
  'One judgment per rule. If a rule needs "and"/"or", write two rules.',
  'State the exact condition: Jev reads literally, so put boundary cases in the criteria.',
  'Never ask Jev to count, add, or compare numbers or dates; pre-compute those fields.',
  'Prefer Choice with an explicit "none of these" option over an open-ended question.',
  'Do not reuse a threshold across question types (a Noul value is not a probability).',
  'Use minConfidence on risky Choice/Score rules and uncertainPolicy "review" to keep uncertain hits visible.',
  'Test every rule with one positive and one negative sample before enabling it.',
];

export function RuleAuthoringGuidance() {
  return (
    <aside className="rounded-lg border border-sky-200 bg-sky-50 p-3">
      <h2 className="text-sm font-semibold text-sky-900">Rule authoring rules of thumb</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-sky-900">
        {TIPS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
    </aside>
  );
}
