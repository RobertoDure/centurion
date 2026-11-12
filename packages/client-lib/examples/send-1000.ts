import process from 'node:process';

import { LogClient, type LogRecordInput } from '../src/index';

const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092')
  .split(',')
  .map((broker) => broker.trim())
  .filter((broker) => broker.length > 0);
const topic = process.env.KAFKA_TOPIC_RAW ?? 'logs.raw';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

const total = envInt('EXAMPLE_RECORDS', 1000);
const batchSize = envInt('EXAMPLE_BATCH_SIZE', 100);

async function main(): Promise<void> {
  const client = new LogClient({
    brokers,
    topic,
    clientId: 'client-lib-example',
    source: { id: 'client-lib-example', environment: 'local' },
    batch: { maxRecords: batchSize, lingerMs: 10, maxBufferBytes: 16 * 1024 * 1024 },
    failureMode: 'throw',
  });

  const runId = new Date().toISOString();
  const startedAt = Date.now();
  let sent = 0;

  for (let offset = 0; offset < total; offset += batchSize) {
    const size = Math.min(batchSize, total - offset);
    const records: LogRecordInput[] = Array.from({ length: size }, (_, index) => ({
      level: 'info',
      payload: {
        message: `example record ${offset + index + 1}`,
        index: offset + index + 1,
        runId,
      },
      attributes: { run: runId, index: String(offset + index + 1) },
    }));
    await client.sendBatch(records);
    sent += size;
  }

  await client.flush();
  const elapsedMs = Date.now() - startedAt;
  const stats = client.stats;

  console.log('Centurion client-lib example');
  console.log(`  brokers:   ${brokers.join(',')}`);
  console.log(`  topic:     ${topic}`);
  console.log(`  run id:    ${runId}`);
  console.log(`  queued:    ${sent} records in ${Math.ceil(sent / batchSize)} batches`);
  console.log(
    `  elapsed:   ${elapsedMs} ms (${Math.round((stats.delivered / Math.max(elapsedMs, 1)) * 1000)} records/s)`,
  );
  console.log(`  delivered: ${stats.delivered}`);
  console.log(`  dropped:   ${stats.dropped}`);
  console.log(`  failed:    ${stats.failed}`);
  console.log(`  retried:   ${stats.retried}`);
  console.log(`  warnings:  ${stats.warnings}`);

  await client.close();
}

void main().catch((error: unknown) => {
  console.error('example failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
