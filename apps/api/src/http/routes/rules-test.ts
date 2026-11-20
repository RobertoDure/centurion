import { evaluateRule, ruleTestRequestSchema, ruleTestResponseSchema } from '@centurion/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { buildState } from '../../jev/state-builder';
import type { HttpAppDeps } from '../deps';
import { sendJevProblem, sendProblem } from '../errors';

/** Question id used for the single dry-run question; Jev echoes it back. */
export const RULE_TEST_QUESTION_ID = 'sample';

export function registerRuleTestRoutes(app: FastifyInstance, deps: HttpAppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post('/rules/test', {
    schema: {
      tags: ['rules'],
      summary: 'Dry-run a question and condition against a sample log',
      description:
        'Builds Jev state from the sample payload, calls Jev once (rate-limited) and returns the typed answer plus the verdict. Mismatched question/condition types are rejected with 422.',
      body: ruleTestRequestSchema,
      response: { 200: ruleTestResponseSchema },
    },
    handler: async (request, reply) => {
      await deps.ruleTestRateLimiter?.acquire();
      const { question, condition, sample } = request.body;
      const state = buildState(sample, { redactKeys: deps.redactKeys });
      let evaluation;
      try {
        evaluation = await deps.gateway.evaluate({
          state,
          questions: { [RULE_TEST_QUESTION_ID]: question },
        });
      } catch (error) {
        sendJevProblem(reply, error);
        return;
      }
      const answer = evaluation.answers[RULE_TEST_QUESTION_ID];
      if (answer === undefined) {
        sendProblem(reply, 502, 'Bad Gateway', 'Jev did not return an answer for the sample question');
        return;
      }
      return {
        answer,
        verdict: evaluateRule({ condition }, answer),
        model: evaluation.model,
        usage: evaluation.usage,
      };
    },
  });
}
