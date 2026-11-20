import { problemDetailsSchema, type ProblemDetails } from '@centurion/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

import {
  JevAuthError,
  JevError,
  JevNetworkError,
  JevOverloadedError,
  JevRateLimitError,
  JevValidationError,
} from '../jev/errors';

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  529: 'Site Overloaded',
};

function httpTitle(status: number): string {
  return STATUS_TITLES[status] ?? (status >= 500 ? 'Internal Server Error' : 'Request Error');
}

export interface ProblemInput {
  status: number;
  title: string;
  detail?: string;
  errors?: ProblemDetails['errors'];
}

/** Build an RFC 9457 problem+json body (validated by the shared contracts schema). */
export function buildProblem(input: ProblemInput): ProblemDetails {
  return problemDetailsSchema.parse({
    type: 'about:blank',
    title: input.title,
    status: input.status,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    ...(input.errors === undefined ? {} : { errors: input.errors }),
  });
}

/** Send problem+json; returns the reply so handlers can `return sendProblem(...)`. */
export function sendProblem(
  reply: FastifyReply,
  status: number,
  title: string,
  detail?: string,
  errors?: ProblemDetails['errors'],
): FastifyReply {
  return reply
    .code(status)
    .type('application/problem+json')
    .send(buildProblem({ status, title, detail, errors }));
}

/** Map a Jev domain error onto an HTTP problem. Other errors are re-thrown. */
export function sendJevProblem(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof JevRateLimitError) {
    return sendProblem(reply, 429, httpTitle(429), error.message);
  }
  if (error instanceof JevAuthError) {
    return sendProblem(reply, 503, httpTitle(503), error.message);
  }
  if (error instanceof JevOverloadedError) {
    return sendProblem(reply, 529, httpTitle(529), error.message);
  }
  if (error instanceof JevValidationError) {
    return sendProblem(reply, 422, httpTitle(422), error.message);
  }
  if (error instanceof JevNetworkError) {
    return sendProblem(reply, 502, httpTitle(502), error.message);
  }
  throw error;
}

function toFieldPath(instancePath: string | undefined): string {
  const trimmed = (instancePath ?? '').replace(/^\//, '');
  return trimmed.length === 0 ? '(root)' : trimmed.replace(/\//g, '.');
}

function errorStatusCode(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const value = (error as { statusCode?: unknown }).statusCode;
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  return 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed';
}

/** Fastify not-found and error handlers that always answer with problem+json. */
export function registerProblemHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    return sendProblem(reply, 404, httpTitle(404), `Route ${request.method} ${request.url} not found`);
  });

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const issues = error.validation.map((issue) => ({
        path: toFieldPath(issue.instancePath),
        message: issue.message ?? 'invalid value',
      }));
      return sendProblem(reply, 422, httpTitle(422), 'request validation failed', issues);
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'response failed to serialize');
      return sendProblem(reply, 500, httpTitle(500), 'response did not match its schema');
    }
    if (error instanceof JevError) {
      return sendJevProblem(reply, error);
    }
    const status = errorStatusCode(error);
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    const detail = status >= 500 ? 'internal server error' : errorMessage(error);
    return sendProblem(reply, status, httpTitle(status), detail);
  });
}
