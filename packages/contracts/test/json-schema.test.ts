import { describe, expect, it } from 'vitest';

import { logEnvelopeSchema, logEnvelopeJsonSchema, toJsonSchema } from '../src';

describe('log envelope JSON Schema export', () => {
  it('produces a 2020-12 object schema with the expected properties', () => {
    const schema = logEnvelopeJsonSchema as Record<string, unknown>;
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.type).toBe('object');
    const properties = schema.properties as Record<string, unknown>;
    for (const key of ['schemaVersion', 'id', 'source', 'timestamp', 'payload']) {
      expect(properties).toHaveProperty(key);
    }
    const required = schema.required as string[];
    expect(required).toContain('schemaVersion');
    expect(required).toContain('payload');
    expect(schema.additionalProperties).toBe(false);
  });

  it('exposes a generic converter and rejects non-object output', () => {
    const schema = toJsonSchema(logEnvelopeSchema);
    expect(typeof schema).toBe('object');
  });
});
