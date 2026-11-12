import { randomUUID } from 'node:crypto';

/**
 * Default record id generator. PLAN.md section 5.1 allows a ULID or UUID; a
 * v4 UUID needs no extra dependency and is what the client uses unless an
 * `idFactory` is supplied.
 */
export function defaultIdFactory(): string {
  return randomUUID();
}
