import { pino } from 'pino';

import { buildApp } from './app';
import { loadConfig } from './config';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
  const app = await buildApp({ config, logger });
  await app.start();
  logger.info({ host: config.HOST, port: config.PORT }, 'centurion api listening');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      await app.stop();
    } catch (error) {
      logger.error({ err: error }, 'graceful shutdown failed');
      process.exitCode = 1;
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
