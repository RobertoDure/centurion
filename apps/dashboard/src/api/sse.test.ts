import { describe, expect, it } from 'vitest';

import { parseSseBuffer, toSseEvent } from './sse';

describe('sse parser', () => {
  it('splits complete frames and keeps the partial remainder', () => {
    const { frames, rest } = parseSseBuffer(
      'id: 1\nevent: consumer.status\ndata: {"status":"running","at":"2026-01-01T00:00:00.000Z"}\n\nid: 2\nevent:',
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]?.id).toBe('1');
    expect(frames[0]?.event).toBe('consumer.status');
    expect(rest).toBe('id: 2\nevent:');
  });

  it('ignores comments and validates event payloads', () => {
    const { frames } = parseSseBuffer(': heartbeat\n\n');
    expect(frames).toHaveLength(0);

    const valid = toSseEvent({
      event: 'log.processed',
      data: JSON.stringify({
        messageId: 'm1',
        sourceId: 'svc',
        status: 'clean',
        flagCount: 0,
        partial: false,
      }),
    });
    expect(valid?.type).toBe('log.processed');
    expect(toSseEvent({ event: 'log.processed', data: 'not-json' })).toBeUndefined();
    expect(toSseEvent({ event: 'unknown.event', data: '{}' })).toBeUndefined();
    expect(toSseEvent({ event: 'log.processed', data: '{}' })).toBeUndefined();
  });
});
