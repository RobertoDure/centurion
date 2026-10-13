export type JevErrorCode =
  | 'JEV_AUTH'
  | 'JEV_RATE_LIMIT'
  | 'JEV_OVERLOADED'
  | 'JEV_VALIDATION'
  | 'JEV_NETWORK';

export interface JevErrorOptions {
  cause?: unknown;
}

export class JevError extends Error {
  readonly code: JevErrorCode;

  constructor(code: JevErrorCode, message: string, options: JevErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
  }
}

export class JevAuthError extends JevError {
  constructor(message = 'Jev authentication failed', options: JevErrorOptions = {}) {
    super('JEV_AUTH', message, options);
  }
}

export class JevRateLimitError extends JevError {
  readonly retryAfterMs: number | undefined;

  constructor(
    message = 'Jev rate limit exceeded',
    options: JevErrorOptions & { retryAfterMs?: number } = {},
  ) {
    super('JEV_RATE_LIMIT', message, options);
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class JevOverloadedError extends JevError {
  constructor(message = 'Jev is overloaded', options: JevErrorOptions = {}) {
    super('JEV_OVERLOADED', message, options);
  }
}

export class JevValidationError extends JevError {
  readonly issues: readonly string[];

  constructor(
    message = 'Jev rejected the request',
    options: JevErrorOptions & { issues?: readonly string[] } = {},
  ) {
    super('JEV_VALIDATION', message, options);
    this.issues = options.issues ?? [];
  }
}

export class JevNetworkError extends JevError {
  constructor(message = 'Jev network error', options: JevErrorOptions = {}) {
    super('JEV_NETWORK', message, options);
  }
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

function extractStatus(error: unknown): number | undefined {
  for (const candidate of [
    readProperty(error, 'status'),
    readProperty(error, 'statusCode'),
    readProperty(readProperty(error, 'response'), 'status'),
  ]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) return candidate;
  }
  return undefined;
}

function extractRetryAfterMs(error: unknown): number | undefined {
  for (const candidate of [
    readProperty(error, 'retryAfterMs'),
    readProperty(error, 'retryAfterSeconds'),
    readProperty(readProperty(error, 'response'), 'retryAfterMs'),
  ]) {
    if (typeof candidate === 'number' && candidate >= 0) {
      return candidate > 1000 ? candidate : candidate * 1000;
    }
  }
  return undefined;
}

function extractIssues(error: unknown): string[] {
  const issues = readProperty(error, 'issues') ?? readProperty(error, 'errors');
  if (!Array.isArray(issues)) return [];
  return issues.map((issue) =>
    typeof issue === 'string' ? issue : JSON.stringify(issue ?? 'unknown error'),
  );
}

/** Maps a transport/SDK failure onto the domain error taxonomy from PLAN.md section 6. */
export function mapJevError(error: unknown): JevError {
  if (error instanceof JevError) return error;
  switch (extractStatus(error)) {
    case 401:
    case 403:
      return new JevAuthError('Jev authentication failed', { cause: error });
    case 422:
      return new JevValidationError('Jev rejected the request', {
        cause: error,
        issues: extractIssues(error),
      });
    case 429:
      return new JevRateLimitError('Jev rate limit exceeded', {
        cause: error,
        retryAfterMs: extractRetryAfterMs(error),
      });
    case 529:
      return new JevOverloadedError('Jev is overloaded', { cause: error });
    default:
      return new JevNetworkError('Jev request failed', { cause: error });
  }
}
