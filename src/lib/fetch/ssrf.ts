import dns from 'node:dns';
import net from 'node:net';
import { UnsafeUrlError } from './errors';

function blockedV4(o: number[]): boolean {
  const [a, b, c] = o;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function parseV4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  return nums.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? nums : null;
}

export function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const o = parseV4(ip);
    return o ? blockedV4(o) : true;
  }
  if (version === 6) {
    let s: string;
    try {
      // WHATWG serialization gives the canonical compressed lowercase form.
      s = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    } catch {
      return true;
    }
    if (s === '::' || s === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isBlockedIp(mapped[1]);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return blockedV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
    }
    if (/^f[cd]/.test(s)) return true; // fc00::/7 unique local
    if (/^fe[89ab]/.test(s)) return true; // fe80::/10 link local
    if (s.startsWith('64:ff9b:')) return true; // NAT64
    if (s.startsWith('2002:')) return true; // 6to4
    return false;
  }
  return true; // not an IP literal: fail closed
}

export function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${raw.slice(0, 100)}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new UnsafeUrlError(`Blocked protocol ${u.protocol}`);
  }
  if (u.username || u.password) throw new UnsafeUrlError('Blocked URL with credentials');
  if (u.port && u.port !== '80' && u.port !== '443') throw new UnsafeUrlError(`Blocked port ${u.port}`);
  const host = (u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname).toLowerCase().replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan')
  ) {
    throw new UnsafeUrlError(`Blocked hostname ${host}`);
  }
  if (net.isIP(host) && isBlockedIp(host)) throw new UnsafeUrlError(`Blocked address ${host}`);
  return u;
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

type LookupCallback = (err: Error | null, address?: any, family?: number) => void;

export function createSafeLookup(resolver: Resolver = defaultResolver) {
  return (hostname: string, options: { all?: boolean } | undefined, cb: LookupCallback): void => {
    resolver(hostname).then(
      (addrs) => {
        if (addrs.length === 0) return cb(new UnsafeUrlError(`No addresses for ${hostname}`));
        const bad = addrs.find((a) => isBlockedIp(a.address));
        if (bad) return cb(new UnsafeUrlError(`Blocked address ${bad.address} for ${hostname}`));
        if (options?.all) cb(null, addrs);
        else cb(null, addrs[0].address, addrs[0].family);
      },
      (err) => cb(err instanceof Error ? err : new Error(String(err))),
    );
  };
}
