import { sseEventSchema, type SseEvent } from '@centurion/contracts';

import { apiUrl } from './client';

/** One parsed SSE frame (a block of field lines terminated by a blank line). */
export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

/**
 * Split a text buffer into complete SSE frames. Returns the frames plus the
 * trailing partial frame that must be prepended to the next chunk.
 */
export function parseSseBuffer(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let rest = buffer;
  let boundary = rest.indexOf('\n\n');
  while (boundary !== -1) {
    const raw = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const frame = parseFrame(raw);
    if (frame !== undefined) frames.push(frame);
    boundary = rest.indexOf('\n\n');
  }
  return { frames, rest };
}

function parseFrame(raw: string): SseFrame | undefined {
  let event: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'id' && !value.includes('\0')) id = value;
  }
  if (event === undefined && id === undefined && dataLines.length === 0) return undefined;
  return {
    ...(id === undefined ? {} : { id }),
    ...(event === undefined ? {} : { event }),
    data: dataLines.join('\n'),
  };
}

/** Validate a frame payload against the shared SSE contract. Invalid frames are dropped. */
export function toSseEvent(frame: SseFrame): SseEvent | undefined {
  if (frame.event === undefined || frame.data === '') return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data) as unknown;
  } catch {
    return undefined;
  }
  const parsed = sseEventSchema.safeParse({ type: frame.event, data: payload });
  return parsed.success ? parsed.data : undefined;
}

export interface SseStreamOptions {
  url: string;
  signal: AbortSignal;
  lastEventId?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Opens an SSE stream with fetch and yields parsed frames until the response
 * body ends or the signal aborts. Sends `Last-Event-ID` when a resume point is
 * known so the server can replay missed events from its ring buffer.
 */
export async function* readSseStream(options: SseStreamOptions): AsyncGenerator<SseFrame> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = new Headers({ accept: 'text/event-stream' });
  if (options.lastEventId !== undefined) headers.set('Last-Event-ID', options.lastEventId);
  const response = await fetchImpl(options.url, { headers, signal: options.signal });
  if (!response.ok) {
    throw new Error(`SSE request failed with status ${response.status}`);
  }
  if (response.body === null) {
    throw new Error('SSE response has no body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSseBuffer(buffer);
      buffer = rest;
      for (const frame of frames) yield frame;
    }
    if (buffer.trim() !== '') {
      const { frames } = parseSseBuffer(`${buffer}\n\n`);
      for (const frame of frames) yield frame;
    }
  } finally {
    reader.releaseLock();
  }
}

export function sseUrl(): string {
  return apiUrl('/api/v1/stream');
}
