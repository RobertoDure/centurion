import { describe, expect, it } from 'vitest';

import {
  assertUrlAllowed,
  isAllowedHost,
  isBlockedAddress,
  isBlockedIpv4,
  SsrfError,
  stripBrackets,
} from '../src/actions/ssrf';

describe('isBlockedAddress / IPv4', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.10',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1', '203.0.114.1', '198.51.101.1', '203.1.0.1'])(
    'allows public %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it('ignores malformed IPv4-like strings', () => {
    expect(isBlockedIpv4('999.1.1.1')).toBe(false);
    expect(isBlockedIpv4('10.1.1')).toBe(false);
  });
});

describe('isBlockedAddress / IPv6', () => {
  it.each(['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '[::1]'])(
    'blocks %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(true);
    },
  );

  it.each(['2001:4860:4860::8888', '2606:4700:4700::1111'])('allows public %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it('unwraps IPv4-mapped addresses', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('helpers', () => {
  it('strips IPv6 brackets', () => {
    expect(stripBrackets('[::1]')).toBe('::1');
    expect(stripBrackets('example.com')).toBe('example.com');
  });

  it('matches exact and wildcard allowed hosts', () => {
    expect(isAllowedHost('hooks.example.com', ['hooks.example.com'])).toBe(true);
    expect(isAllowedHost('a.example.com', ['*.example.com'])).toBe(true);
    expect(isAllowedHost('example.com', ['*.example.com'])).toBe(false);
    expect(isAllowedHost('other.com', ['*.example.com'])).toBe(false);
    expect(isAllowedHost('localhost', [])).toBe(false);
  });
});

describe('assertUrlAllowed', () => {
  it('rejects non-HTTP(S) protocols', async () => {
    await expect(assertUrlAllowed('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertUrlAllowed('ftp://example.com')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertUrlAllowed('not a url')).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects loopback hostnames without DNS', async () => {
    await expect(assertUrlAllowed('http://localhost:3000/hook')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertUrlAllowed('http://thing.localhost/hook')).rejects.toBeInstanceOf(SsrfError);
  });

  it('allows an explicit allowlisted host even when it is loopback', async () => {
    const url = await assertUrlAllowed('http://localhost:3000/hook', { allowedHosts: ['localhost'] });
    expect(url.hostname).toBe('localhost');
  });

  it('rejects a literal private address', async () => {
    await expect(assertUrlAllowed('http://169.254.169.254/latest/meta-data')).rejects.toBeInstanceOf(
      SsrfError,
    );
    await expect(assertUrlAllowed('http://[::1]:8080/hook')).rejects.toBeInstanceOf(SsrfError);
  });

  it('allows a literal public address', async () => {
    const url = await assertUrlAllowed('https://8.8.8.8/hook');
    expect(url.hostname).toBe('8.8.8.8');
  });

  it('rejects a host that resolves to a private address', async () => {
    await expect(
      assertUrlAllowed('https://internal.example.com/hook', {
        resolve: async () => ['10.0.0.5', '93.184.216.34'],
      }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('allows a host that resolves only to public addresses', async () => {
    const url = await assertUrlAllowed('https://hooks.example.com/x', {
      resolve: async () => ['93.184.216.34', '2606:4700::1111'],
    });
    expect(url.hostname).toBe('hooks.example.com');
  });

  it('rejects a host that does not resolve', async () => {
    await expect(
      assertUrlAllowed('https://nope.example.com/x', {
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertUrlAllowed('https://empty.example.com/x', { resolve: async () => [] }),
    ).rejects.toBeInstanceOf(SsrfError);
  });
});
