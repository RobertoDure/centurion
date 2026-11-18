import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

import { resetDb } from '../mocks/db';
import { server } from '../mocks/server';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  resetDb();
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
