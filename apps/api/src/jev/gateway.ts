import {
  jevApiRequestSchema,
  jevApiResponseSchema,
  type JsonValue,
  type JevApiRequest,
  type JevApiResponse,
  type JevEvaluation,
  type JevQuestion,
} from '@centurion/contracts';

import { JevError, JevValidationError, mapJevError } from './errors';
import type { RateLimiter } from './rate-limiter';
import { estimateTokens, type TokenCalibrator } from './token-estimator';

export interface JevTransport {
  evaluate(request: JevApiRequest, signal?: AbortSignal): Promise<JevApiResponse>;
}

export interface JevGatewayOptions {
  transport: JevTransport;
  /** Pinned model id, e.g. jev-1.13.0 (assumption A8). */
  model: string;
  rateLimiter?: RateLimiter;
  calibrator?: TokenCalibrator;
}

export interface JevEvaluateInput {
  state: JsonValue;
  questions: Record<string, JevQuestion>;
}

export interface JevGateway {
  evaluate(input: JevEvaluateInput): Promise<JevEvaluation>;
}

/**
 * The only place that talks to Jev. Validates both directions with contracts,
 * applies the rate limiter, records the estimate/actual token ratio and maps
 * every failure onto the domain error taxonomy.
 */
export class DefaultJevGateway implements JevGateway {
  private readonly transport: JevTransport;
  private readonly model: string;
  private readonly rateLimiter: RateLimiter | undefined;
  private readonly calibrator: TokenCalibrator | undefined;

  constructor(options: JevGatewayOptions) {
    this.transport = options.transport;
    this.model = options.model;
    this.rateLimiter = options.rateLimiter;
    this.calibrator = options.calibrator;
  }

  async evaluate(input: JevEvaluateInput): Promise<JevEvaluation> {
    const request = { state: input.state, model: this.model, questions: input.questions };
    const parsedRequest = jevApiRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new JevValidationError('Invalid Jev request', {
        issues: parsedRequest.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }

    await this.rateLimiter?.acquire();

    let raw: JevApiResponse;
    try {
      raw = await this.transport.evaluate(parsedRequest.data);
    } catch (error) {
      if (error instanceof JevError) throw error;
      throw mapJevError(error);
    }

    const parsedResponse = jevApiResponseSchema.safeParse(raw);
    if (!parsedResponse.success) {
      throw new JevValidationError('Invalid Jev response', {
        issues: parsedResponse.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ),
      });
    }

    this.calibrator?.record(estimateTokens(request), parsedResponse.data.usage.input_tokens);

    return {
      model: parsedResponse.data.model,
      answers: parsedResponse.data.answers,
      usage: {
        inputTokens: parsedResponse.data.usage.input_tokens,
        outputTokens: parsedResponse.data.usage.output_tokens,
      },
    };
  }
}
