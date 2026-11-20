import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from '../src/http/openapi';

describe('OpenAPI generation', () => {
  it('builds a document that includes the rules and stream routes', async () => {
    const document = await buildOpenApiDocument();
    const paths = document['paths'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/rules',
        '/api/v1/rules/{id}',
        '/api/v1/rules/test',
        '/api/v1/actions',
        '/api/v1/flags',
        '/api/v1/stream',
        '/api/v1/health',
        '/api/v1/ready',
        '/api/v1/metrics',
      ]),
    );
    expect(document['openapi']).toBe('3.0.3');
    const info = document['info'] as { title: string };
    expect(info.title).toBe('Centurion API');

    const rulesPost = paths['/api/v1/rules']?.['post'] as {
      requestBody?: { content?: Record<string, { schema?: { properties?: Record<string, unknown> } }> };
    };
    const bodySchema = rulesPost?.requestBody?.content?.['application/json']?.schema;
    expect(bodySchema?.properties).toHaveProperty('question');
    expect(bodySchema?.properties).toHaveProperty('condition');
  });
});
