import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { SseClient } from '../../sse/hub';
import type { HttpAppDeps } from '../deps';
import { sendProblem } from '../errors';

export function registerStreamRoutes(app: FastifyInstance, deps: HttpAppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/stream', {
    schema: {
      tags: ['stream'],
      summary: 'Server-Sent Events stream',
      description:
        'Streams log.processed, flag.created and consumer.status events. Send Last-Event-ID to replay missed events from the ring buffer; a heartbeat comment keeps idle connections open.',
      produces: ['text/event-stream'],
    },
    handler: (request, reply) => {
      const hub = deps.sseHub;
      if (hub === undefined) {
        sendProblem(reply, 503, 'Service Unavailable', 'SSE stream is not configured');
        return;
      }
      const header = request.headers['last-event-id'];
      const lastEventId = Array.isArray(header) ? header[0] : header;

      reply.hijack();

      const client: SseClient = {
        write: (chunk) => reply.raw.write(chunk),
        close: () => {
          try {
            reply.raw.end();
          } catch {
            // The client is already gone.
          }
        },
      };

      // Subscribe before flushing headers so an event published immediately
      // after connect cannot race the subscriber registration.
      const unsubscribe = hub.subscribe(client, { lastEventId });
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      // Node only flushes the header with the first write; this comment opens
      // the stream immediately so EventSource/fetch observes the response.
      reply.raw.write(': connected\n\n');
      reply.raw.on('drain', () => {
        hub.flush(client);
      });
      request.raw.on('close', () => {
        unsubscribe();
      });
    },
  });
}
