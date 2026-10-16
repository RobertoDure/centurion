export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function parseIpv4(address: string): number[] | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const value = Number(part);
    if (value > 255) return undefined;
    octets.push(value);
  }
  return octets;
}

export function isBlockedIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (octets === undefined) return false;
  const [a = -1, b = -1, c = -1] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol + TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * Blocks loopback, private, link-local, CGNAT, multicast and reserved ranges.
 * IPv4-mapped IPv6 addresses are unwrapped and re-checked as IPv4.
 */
export function isBlockedAddress(address: string): boolean {
  const bare = stripBrackets(address).toLowerCase();
  if (parseIpv4(bare) !== undefined) return isBlockedIpv4(bare);
  if (bare === '::1' || bare === '::') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
  if (mapped?.[1] !== undefined) return isBlockedIpv4(mapped[1]);
  if (/^f[cd][0-9a-f]{2}:/.test(bare)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(bare)) return true; // fe80::/10 link local
  if (/^ff[0-9a-f]{2}:/.test(bare)) return true; // ff00::/8 multicast
  return false;
}

export function isIpLiteral(hostname: string): boolean {
  const bare = stripBrackets(hostname);
  if (parseIpv4(bare) !== undefined) return true;
  return bare.includes(':');
}

export function isAllowedHost(hostname: string, allowedHosts: readonly string[] | undefined): boolean {
  if (allowedHosts === undefined || allowedHosts.length === 0) return false;
  const host = stripBrackets(hostname).toLowerCase();
  for (const entry of allowedHosts) {
    const allowed = entry.trim().toLowerCase();
    if (allowed.length === 0) continue;
    if (allowed === host) return true;
    if (allowed.startsWith('*.') && host.endsWith(allowed.slice(1)) && host.length > allowed.length - 1) {
      return true;
    }
  }
  return false;
}

export type Resolver = (hostname: string) => Promise<string[]>;

async function defaultResolve(hostname: string): Promise<string[]> {
  const dns = await import('node:dns/promises');
  const records = await dns.lookup(hostname, { all: true });
  return records.map((record) => record.address);
}

export interface SsrfGuardOptions {
  /** Hosts that bypass the private-range check entirely (WEBHOOK_ALLOWED_HOSTS). */
  allowedHosts?: readonly string[];
  /** Injectable DNS resolver for tests. */
  resolve?: Resolver;
}

/**
 * Validate an outbound webhook URL. Throws SsrfError for non-HTTP(S) schemes,
 * loopback/private destinations and hosts that fail to resolve.
 */
export async function assertUrlAllowed(rawUrl: string, options: SsrfGuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`blocked protocol: ${url.protocol}`);
  }
  if (isAllowedHost(url.hostname, options.allowedHosts)) return url;

  const host = stripBrackets(url.hostname).toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new SsrfError('blocked loopback host');
  }
  if (isIpLiteral(url.hostname)) {
    if (isBlockedAddress(url.hostname)) throw new SsrfError(`blocked address: ${url.hostname}`);
    return url;
  }

  const resolve = options.resolve ?? defaultResolve;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new SsrfError(`could not resolve host: ${host}`);
  }
  if (addresses.length === 0) throw new SsrfError(`could not resolve host: ${host}`);
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new SsrfError(`host ${host} resolves to a blocked address: ${address}`);
    }
  }
  return url;
}
