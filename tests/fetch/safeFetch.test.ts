import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSafeFetch } from '@/lib/fetch/safeFetch';

describe('createSafeFetch', () => {
  it('refuses to connect to a local server through a hostname that resolves to loopback', async () => {
    const server = http.createServer((_req, res) => res.end('secret'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const safeFetch = createSafeFetch();
      await expect(safeFetch(`http://localhost:${port}/`)).rejects.toThrow();
    } finally {
      server.close();
    }
  });
});
