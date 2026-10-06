import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb, createPool, databaseUrlFromEnv } from './client';

const pool = createPool(databaseUrlFromEnv());

try {
  await migrate(createDb(pool), { migrationsFolder: './drizzle' });
  console.log('Migrations applied');
} finally {
  await pool.end();
}
