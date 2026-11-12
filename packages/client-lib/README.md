# @centurion/client-lib

The Centurion log producer. It validates every record against the shared
[`@centurion/contracts`](../contracts) envelope, stamps ids and timestamps,
and publishes batches to Kafka with bounded buffering, retries, and
failure modes that never crash the host application by default.

## Quick start

```ts
import { LogClient } from '@centurion/client-lib';

const logs = new LogClient({
  brokers: ['localhost:9092'],
  topic: 'logs.raw',
  source: { id: 'checkout-api', environment: 'prod' },
  batch: { maxRecords: 500, lingerMs: 5, maxBufferBytes: 8 * 1024 * 1024 },
  failureMode: 'drop', // default
  onError: (error, context) => console.error('log delivery failed', context, error),
});

await logs.send({ level: 'info', payload: { message: 'order created', orderId: 42 } });
await logs.sendBatch([
  { level: 'warn', payload: 'cache miss', attributes: { region: 'eu-west-1' } },
  { level: 'error', payload: { message: 'payment declined', code: 402 } },
]);
await logs.flush();
await logs.close();
```

## Constructor options

| Option                 | Type                                                      | Default                 | Notes                                                               |
| ---------------------- | --------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `brokers`              | `string[]`                                                | required                | Kafka bootstrap brokers.                                            |
| `topic`                | `string`                                                  | required                | Destination topic, e.g. `logs.raw`.                                 |
| `source`               | `{ id; name?; environment? }`                             | required                | Stamped on every envelope and used as the Kafka key.                |
| `auth`                 | `{ ssl?; sasl? }`                                         | –                       | Passed to kafkajs (`ssl` boolean, `sasl` mechanism options).        |
| `compression`          | `'none' \| 'gzip' \| 'snappy' \| 'lz4' \| 'zstd'`         | `'none'`                | Producer compression codec.                                         |
| `batch.maxRecords`     | `number`                                                  | `500`                   | Queue + in-flight batch bound.                                      |
| `batch.lingerMs`       | `number`                                                  | `5`                     | How long a partial batch waits for more records.                    |
| `batch.maxBufferBytes` | `number`                                                  | `8388608`               | Queue + in-flight byte bound.                                       |
| `failureMode`          | `'drop' \| 'throw' \| 'callback'`                         | `'drop'`                | See below.                                                          |
| `onError`              | `(error, context) => void`                                | –                       | Called on every delivery/enqueue failure; exceptions are swallowed. |
| `onWarning`            | `(warning) => void`                                       | console.warn            | Called when a record exceeds `warnPayloadBytes`.                    |
| `clientId`             | `string`                                                  | `@centurion/client-lib` | kafkajs client id.                                                  |
| `warnPayloadBytes`     | `number`                                                  | `1048576`               | Emit a warning above this size; records are never truncated.        |
| `retry`                | `{ maxAttempts; initialBackoffMs; maxBackoffMs; jitter }` | `3 / 50 / 2000 / true`  | Exponential backoff with equal jitter.                              |
| `enqueueTimeoutMs`     | `number`                                                  | `5000`                  | How long `send()` waits for buffer space before failing.            |
| `producer`             | `ProducerLike`                                            | kafkajs adapter         | Inject a custom producer (used by tests).                           |
| `idFactory` / `now`    | functions                                                 | UUID / `Date`           | Override id/timestamp generation.                                   |

## Methods

- `send(record): Promise<SendResult>` – validate, stamp, buffer and deliver one record.
- `sendBatch(records): Promise<SendResult[]>` – `send` for each record, in order.
- `flush(): Promise<void>` – resolves once the buffer and in-flight batch are empty.
- `close(): Promise<void>` – flushes, disconnects, and rejects new sends. Idempotent.
- `stats` – counters and buffer occupancy (see `LogClientStats`).
- `topic`, `source` – the configured values.

`SendResult` is `{ id, status: 'delivered' | 'dropped' | 'failed', error? }`.

## Failure modes

| Mode             | Delivery failure                                         | Buffer stays full past `enqueueTimeoutMs` |
| ---------------- | -------------------------------------------------------- | ----------------------------------------- |
| `drop` (default) | resolves `status: 'dropped'`, increments `stats.dropped` | same                                      |
| `throw`          | rejects the `send` promise with the producer error       | rejects with `LogBufferFullError`         |
| `callback`       | resolves `status: 'failed'`, increments `stats.failed`   | same                                      |

`onError` is invoked for every failure in every mode. Invalid records
(failing `logEnvelopeSchema`) always reject with `LogValidationError`,
regardless of `failureMode` — that is a programming error, not a broker fault.

## Kafka wire format

- **Value** – JSON `LogEnvelope` with `schemaVersion: 1`.
- **Key** – `source.id`.
- **Headers** – `schema-version: 1`, `content-type: application/json`.

## Buffering, backpressure and size

The queue plus the in-flight batch never exceed `maxRecords` or
`maxBufferBytes`. When both are full, `send` waits for space and only then
applies `failureMode`. A broker outage therefore fails fast (or queues inside
the bounded buffer) and `flush()` always settles.

There is **no client-side payload size cap** — a single large record is always
admitted, even if it exceeds `maxBufferBytes`, because PLAN.md section 7.1
assigns oversize handling to the server. Records above `warnPayloadBytes`
just emit a warning.

## Example

The example sends 1000 records to `logs.raw` in batches of 100 and prints a
summary (requires Kafka on `localhost:9092`):

```bash
pnpm --filter @centurion/client-lib example
# or, with overrides
KAFKA_BROKERS=localhost:9092 EXAMPLE_RECORDS=1000 EXAMPLE_BATCH_SIZE=100 \
  pnpm --filter @centurion/client-lib example
```

## Tests

```bash
pnpm --filter @centurion/client-lib test             # unit tests, fake producer, no Kafka
pnpm --filter @centurion/client-lib test:integration # real broker; skips if unreachable
```

`test:integration` is not part of `pnpm test`, so the default suite passes
without Kafka.

## Packaging

`pnpm --filter @centurion/client-lib build` runs tsup and writes an ESM
(`dist/index.js`), CJS (`dist/index.cjs`) and declaration
(`dist/index.d.ts`, `dist/index.d.cts`) build. The package `exports` map
selects the right format for `import` and `require`. `@centurion/contracts`
is bundled into the output; kafkajs and zod stay external dependencies.
