import { problemDetailsSchema, type ProblemDetails } from '@centurion/contracts';

const RAW_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/** Base URL for API calls. Empty in the browser (Vite proxies /api); absolute in tests. */
export const API_BASE = RAW_BASE.replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** A structural view of any zod schema, so callers keep the inferred output type. */
export interface Parser<TOutput> {
  parse: (value: unknown) => TOutput;
}

/** RFC 9457 problem+json surfaced as a typed error. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.problem = problem;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toProblem(response: Response, payload: unknown): ProblemDetails {
  const parsed = problemDetailsSchema.safeParse(payload);
  if (parsed.success) return parsed.data;
  return {
    type: 'about:blank',
    title: response.statusText === '' ? `Request failed with status ${response.status}` : response.statusText,
    status: response.status,
  };
}

export async function apiRequest<TOutput>(
  schema: Parser<TOutput>,
  path: string,
  options: ApiRequestOptions = {},
): Promise<TOutput> {
  const headers = new Headers({ accept: 'application/json' });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(apiUrl(path), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    throw new ApiError(toProblem(response, payload));
  }
  return schema.parse(payload);
}

export async function apiRequestVoid(
  path: string,
  options: ApiRequestOptions = {},
): Promise<void> {
  const response = await fetch(apiUrl(path), {
    method: options.method ?? 'DELETE',
    headers: { accept: 'application/json' },
    signal: options.signal,
  });
  if (!response.ok) {
    throw new ApiError(toProblem(response, await readPayload(response)));
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}
