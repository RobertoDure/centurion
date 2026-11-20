import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  decodeEncryptionKey,
  decryptSecret,
  encryptSecret,
  createActionConfigCodec,
} from '../src/security/secrets';

const KEY = randomBytes(32).toString('base64');

function flip(text: string): string {
  const first = text[0] ?? 'A';
  return (first === 'A' ? 'B' : 'A') + text.slice(1);
}

describe('ActionConfigCodec (AES-256-GCM)', () => {
  it('round-trips a webhook secret and never stores it in clear text', () => {
    const codec = createActionConfigCodec(KEY);
    const encoded = codec.encode({
      url: 'https://example.com/hook',
      secret: 's3cr3t-value',
      timeoutMs: 5000,
    });
    expect(encoded['secret']).toMatch(/^enc:v1:/);
    expect(JSON.stringify(encoded)).not.toContain('s3cr3t-value');
    expect(codec.decode(encoded)).toEqual({
      url: 'https://example.com/hook',
      secret: 's3cr3t-value',
      timeoutMs: 5000,
    });
  });

  it('detects tampering with the ciphertext', () => {
    const codec = createActionConfigCodec(KEY);
    const encoded = codec.encode({ url: 'https://example.com/hook', secret: 's3cr3t' });
    const value = String(encoded['secret']);
    const prefix = 'enc:v1:';
    const parts = value.slice(prefix.length).split(':');
    const tampered = {
      ...encoded,
      secret: `${prefix}${parts[0] ?? ''}:${parts[1] ?? ''}:${flip(parts[2] ?? '')}`,
    };
    expect(() => codec.decode(tampered)).toThrow();
    expect(() => decryptSecret(decodeEncryptionKey(KEY), String(tampered['secret']))).toThrow(
      /could not decrypt/,
    );
  });

  it('passes non-webhook configs and configs without a secret through untouched', () => {
    const codec = createActionConfigCodec(KEY);
    const kafkaConfig = { topic: 'logs.flags' };
    expect(codec.encode(kafkaConfig)).toBe(kafkaConfig);
    expect(codec.decode(kafkaConfig)).toBe(kafkaConfig);

    const noSecret = { url: 'https://example.com/hook', timeoutMs: 5000 };
    expect(codec.encode(noSecret)).toBe(noSecret);
    expect(codec.decode(noSecret)).toBe(noSecret);
  });

  it('keeps legacy plaintext secrets readable after the key is introduced', () => {
    const codec = createActionConfigCodec(KEY);
    const legacy = { url: 'https://example.com/hook', secret: 'legacy-plain' };
    expect(codec.decode(legacy)).toBe(legacy);
  });

  it('uses the identity codec and warns once when the key is absent', () => {
    const logger = { warn: vi.fn() };
    const codec = createActionConfigCodec(undefined, { logger });
    const config = { url: 'https://example.com/hook', secret: 'plain' };
    expect(codec.encode(config)).toBe(config);
    expect(codec.decode(config)).toBe(config);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() => createActionConfigCodec(Buffer.from('too-short').toString('base64'))).toThrow(
      /32 bytes/,
    );
  });

  it('exposes symmetric helpers', () => {
    const key = decodeEncryptionKey(KEY);
    expect(decryptSecret(key, encryptSecret(key, 'abc'))).toBe('abc');
  });
});
