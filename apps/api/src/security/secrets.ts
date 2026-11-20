import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { ActionConfigCodec } from '../db/repositories/types';

/** Versioned prefix identifying an AES-256-GCM encrypted secret value. */
export const SECRET_PREFIX = 'enc:v1:';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SecretLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface ActionConfigCodecOptions {
  logger?: SecretLogger;
}

/** Raised when an encrypted secret cannot be authenticated or decrypted. */
export class SecretDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretDecodeError';
  }
}

/** Decode SECRETS_ENCRYPTION_KEY (base64) and assert it is a 32-byte AES-256 key. */
export function decodeEncryptionKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

/** Encrypt one secret into the versioned `enc:v1:<iv>:<tag>:<ciphertext>` string. */
export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_PREFIX + iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/** Decrypt a versioned secret; GCM authentication rejects any tampering. */
export function decryptSecret(key: Buffer, encoded: string): string {
  if (!encoded.startsWith(SECRET_PREFIX)) {
    throw new SecretDecodeError('encrypted secret is missing the enc:v1 prefix');
  }
  const parts = encoded.slice(SECRET_PREFIX.length).split(':');
  const [ivPart, tagPart, dataPart] = parts;
  if (parts.length !== 3 || ivPart === undefined || tagPart === undefined || dataPart === undefined) {
    throw new SecretDecodeError('encrypted secret has an unexpected format');
  }
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const ciphertext = Buffer.from(dataPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretDecodeError('encrypted secret has an unexpected format');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    throw new SecretDecodeError(
      `could not decrypt secret: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function secretFrom(config: Record<string, unknown>): string | undefined {
  const secret = config['secret'];
  return typeof secret === 'string' && secret.length > 0 ? secret : undefined;
}

/**
 * Encrypt the write-only `secret` field of webhook action configs at rest
 * (PLAN.md section 11). Non-webhook configs, and configs without a secret, pass
 * through untouched. When SECRETS_ENCRYPTION_KEY is absent the identity codec is
 * used and a single warning is emitted: the API still works for local
 * development, but nothing is encrypted.
 */
export function createActionConfigCodec(
  keyBase64: string | undefined,
  options: ActionConfigCodecOptions = {},
): ActionConfigCodec {
  if (keyBase64 === undefined || keyBase64.length === 0) {
    options.logger?.warn(
      'SECRETS_ENCRYPTION_KEY is not set; webhook secrets are stored in plaintext',
    );
    return {
      encode: (config) => config,
      decode: (config) => config,
    };
  }

  const key = decodeEncryptionKey(keyBase64);

  return {
    encode(config) {
      const secret = secretFrom(config);
      if (secret === undefined) return config;
      return { ...config, secret: encryptSecret(key, secret) };
    },
    decode(config) {
      const secret = config['secret'];
      if (typeof secret !== 'string' || !secret.startsWith(SECRET_PREFIX)) return config;
      return { ...config, secret: decryptSecret(key, secret) };
    },
  };
}
