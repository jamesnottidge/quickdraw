import { describe, it, expect } from 'vitest';
import { clientIp, deviceCookieHeader, hashIp, isDeviceId, resolveIdentity } from '@/lib/identity';

const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('clientIp', () => {
  it('uses the first x-forwarded-for entry, then x-real-ip, then unknown', () => {
    expect(clientIp(headers({ 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1' }))).toBe('203.0.113.9');
    expect(clientIp(headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIp(headers({}))).toBe('unknown');
  });
});

describe('hashIp', () => {
  it('is stable, salt-dependent and does not contain the address', () => {
    const a = hashIp('203.0.113.9', 'salt1');
    expect(hashIp('203.0.113.9', 'salt1')).toBe(a);
    expect(hashIp('203.0.113.9', 'salt2')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('203');
  });
});

describe('resolveIdentity', () => {
  it('reuses a valid device cookie', () => {
    const id = resolveIdentity({
      cookieValue: uuid, headers: headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'UA' }), salt: 's',
    });
    expect(id).toMatchObject({ deviceId: uuid, isNewDevice: false, userAgent: 'UA' });
    expect(id.ipHash).toBe(hashIp('1.2.3.4', 's'));
  });

  it('issues a new device id when the cookie is missing or malformed', () => {
    const fresh = resolveIdentity({ headers: headers({}), salt: 's', newId: () => uuid });
    expect(fresh).toMatchObject({ deviceId: uuid, isNewDevice: true });
    const bad = resolveIdentity({ cookieValue: "'; drop table runs;--", headers: headers({}), salt: 's', newId: () => uuid });
    expect(bad).toMatchObject({ deviceId: uuid, isNewDevice: true });
  });
});

describe('deviceCookieHeader', () => {
  it('is httpOnly, lax, one year, and Secure only when asked', () => {
    const c = deviceCookieHeader(uuid, true);
    expect(c).toContain(`cdm_device=${uuid}`);
    for (const part of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=31536000', 'Secure']) expect(c).toContain(part);
    expect(deviceCookieHeader(uuid, false)).not.toContain('Secure');
  });
});

describe('isDeviceId', () => {
  it('accepts a UUID and rejects anything else', () => {
    expect(isDeviceId('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(isDeviceId("'; drop table runs;--")).toBe(false);
    expect(isDeviceId('')).toBe(false);
  });
});
