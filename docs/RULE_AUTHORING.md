# Rule authoring

Jev reads instructions literally and is unreliable at counting, arithmetic and date/time
comparison. Rules are atomic by design (PLAN.md assumption A4): one scope, one Jev question, one
typed condition, actions. Compose nothing inside a rule.

## The ten rules

1. **One judgment per rule.** If you need "and"/"or", write two rules. Composition happens in code
   (a stretch task), never inside a question.
2. **State the exact condition.** Put boundary cases in the criteria, not in your head. If a
   declined card is different from an expired card, name both options.
3. **Keep instructions and criteria aligned.** A Noul whose `true` description means "no" performs
   worse. The label must describe the answer it produces.
4. **Never ask Jev to count, add or compare numbers or dates.** Pre-compute those fields into the log
   payload, or filter in code before calling Jev.
5. **Prefer Choice with an explicit "none of these" option** over open-ended questions. Use Score
   only for ordered severity and only ever threshold on it, never interpolate a magnitude.
6. **Do not reuse a threshold across question types.** A Noul threshold is not a Choice
   probability, and Jev's values are not interchangeable between primitives.
7. **Use `minConfidence` on Choice/Score rules that trigger risky actions.** Below the threshold the
   verdict is UNCERTAIN.
8. **Use `uncertainPolicy: 'review'`** when you want uncertain hits to stay visible as flags;
   `'ignore'` drops them and counts them in metrics.
9. **Scope tightly.** `scope.sources` and `scope.levels` are deterministic pre-filters applied in
   code before any Jev call. A narrower scope means fewer tokens and fewer false positives.
10. **Test every rule in the test panel** with at least one positive and one negative sample before
    enabling it.

## Writing a question

| Primitive | Use it for | Answers | Confidence |
|---|---|---|---|
| Noul | a yes/no probability | 0..1 | none |
| Choice | one of 2..255 labelled options | chosen label + probabilities | yes |
| Score | an ordered severity, 2..10 levels | score (may fall between levels) + legend + probabilities | yes |

Keep state small and relevant. The log payload becomes the Jev state; ids, timestamps and other
non-semantic metadata stay out unless the rule needs them. Long irrelevant state lowers accuracy.

## Thresholds

- Noul: `op` `gte`/`lte` with a threshold in `[0, 1]`.
- Choice: pick the options that count (`anyOf`), optionally a `minProbability`, optionally a
  `minConfidence`.
- Score: `op` `gte`/`lte` with a threshold at or below the top level; optionally a
  `minConfidence`.

The editor, the API and every DB read all enforce the same cross-field rules from
`@centurion/contracts`, so a Choice condition cannot reference an option that does not exist, a
Score threshold cannot exceed the level count, and a Noul condition cannot carry `minConfidence`.

## Adversarial logs

Log content is untrusted and may contain text aimed at steering the model. Keep criteria literal
and specific, keep a confidence gate on high-risk actions, and run the adversarial pack
(`pnpm --filter @centurion/api test:pipeline` style scenario, see T8.3) before trusting a new rule
family.
