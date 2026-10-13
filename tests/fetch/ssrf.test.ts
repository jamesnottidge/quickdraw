import { describe, it, expect } from 'vitest';
import { assertSafeUrl, createSafeLookup, isBlockedIp } from '@/lib/fetch/ssrf';
import { UnsafeUrlError } from '@/lib/fetch/errors';

describe('isBlockedIp', () => {
  const blocked = [
    '127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '224.0.0.1', '255.255.255.255', '::1', '::', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1',
    '::ffff:7f00:1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '64:ff9b::7f00:1', '2002:7f00:1::', 'not-an-ip',
  ];
  const allowed = ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.255.255', '100.63.255.255', '2606:4700:4700::1111'];
  it.each(blocked)('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(allowed)('allows %s', (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe('assertSafeUrl', () => {
  const hostile = [
    'ftp://example.com/file',
    'file:///etc/passwd',
    'http://localhost/',
    'http://localhost:3000/',
    'http://foo.localhost/',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/admin',
    'http://user:pw@example.com/',
    'http://example.com:8080/',
    'https://example.com:22/',
    'http://printer.local/',
    'http://db.internal/',
    'http://localhost./',
    'not a url',
  ];
  it.each(hostile)('rejects %s', (u) => expect(() => assertSafeUrl(u)).toThrow(UnsafeUrlError));

  it('accepts ordinary public http(s) URLs', () => {
    expect(assertSafeUrl('https://example.com/a?b=1').hostname).toBe('example.com');
    expect(assertSafeUrl('http://example.com:80/x').hostname).toBe('example.com');
    expect(assertSafeUrl('https://8.8.8.8/x').hostname).toBe('8.8.8.8');
  });
});

describe('createSafeLookup', () => {
  const run = (resolver: any, opts: any = {}) =>
    new Promise<{ err: Error | null; address?: any; family?: number }>((resolve) =>
      createSafeLookup(resolver)('host.test', opts, (err: Error | null, address?: any, family?: number) =>
        resolve({ err, address, family }),
      ),
    );

  it('returns a public address (single and all forms)', async () => {
    const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
    expect(await run(resolver)).toEqual({ err: null, address: '93.184.216.34', family: 4 });
    const all = await run(resolver, { all: true });
    expect(all.err).toBeNull();
    expect(all.address).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('rejects when the hostname resolves to a private address (DNS rebinding)', async () => {
    const r = await run(async () => [{ address: '10.0.0.7', family: 4 }]);
    expect(r.err).toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects if ANY resolved address is private', async () => {
    const r = await run(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ], { all: true });
    expect(r.err).toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects an empty resolution and passes resolver errors through', async () => {
    expect((await run(async () => [])).err).toBeInstanceOf(UnsafeUrlError);
    expect((await run(async () => { throw new Error('ENOTFOUND'); })).err?.message).toBe('ENOTFOUND');
  });
});
