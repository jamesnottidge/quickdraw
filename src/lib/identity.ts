import { createHash, randomUUID } from 'node:crypto';

export const DEVICE_COOKIE = 'cdm_device';

type HeaderGetter = { get(name: string): string | null };

export interface Identity {
  deviceId: string;
  ipHash: string;
  userAgent: string;
  isNewDevice: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDeviceId(value: string): boolean {
  return UUID.test(value);
}

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

export function clientIp(headers: HeaderGetter): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

export function resolveIdentity(i: {
  cookieValue?: string;
  headers: HeaderGetter;
  salt: string;
  newId?: () => string;
}): Identity {
  const valid = i.cookieValue !== undefined && UUID.test(i.cookieValue);
  return {
    deviceId: valid ? (i.cookieValue as string) : (i.newId ?? randomUUID)(),
    ipHash: hashIp(clientIp(i.headers), i.salt),
    userAgent: (i.headers.get('user-agent') ?? '').slice(0, 300),
    isNewDevice: !valid,
  };
}

export function deviceCookieHeader(deviceId: string, secure: boolean): string {
  return `${DEVICE_COOKIE}=${deviceId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`;
}
