import { describe, it, expect } from 'vitest';
import { Channel } from '@/lib/async/channel';
import { createLimiter } from '@/lib/async/limit';
import { streamTasks } from '@/lib/async/streamTasks';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('Channel', () => {
  it('delivers values in order to a waiting consumer and ends on close', async () => {
    const ch = new Channel<number>();
    const got: number[] = [];
    const consumer = (async () => {
      for await (const v of ch) got.push(v);
    })();
    ch.push(1);
    ch.push(2);
    await tick();
    ch.push(3);
    ch.close();
    await consumer;
    expect(got).toEqual([1, 2, 3]);
  });

  it('buffers values pushed before consumption and ignores pushes after close', async () => {
    const ch = new Channel<string>();
    ch.push('a');
    ch.close();
    ch.push('late');
    const got: string[] = [];
    for await (const v of ch) got.push(v);
    expect(got).toEqual(['a']);
  });
});

describe('createLimiter', () => {
  it('never runs more than max tasks at once', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const run = () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await tick();
        active--;
      });
    await Promise.all(Array.from({ length: 8 }, run));
    expect(peak).toBe(2);
  });
});

describe('streamTasks', () => {
  it('yields events as tasks emit them, not when tasks finish', async () => {
    const gate = deferred();
    const it = streamTasks<string>(
      [
        async (emit) => {
          emit('a1');
          await gate.promise;
          emit('a2');
        },
        async (emit) => {
          emit('b1');
        },
      ],
      5,
    );
    expect((await it.next()).value).toBe('a1');
    expect((await it.next()).value).toBe('b1');
    gate.resolve();
    expect((await it.next()).value).toBe('a2');
    expect((await it.next()).done).toBe(true);
  });

  it('respects the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const task = async (emit: (v: number) => void) => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      emit(1);
    };
    const out: number[] = [];
    for await (const v of streamTasks(Array.from({ length: 6 }, () => task), 2)) out.push(v);
    expect(out).toHaveLength(6);
    expect(peak).toBe(2);
  });

  it('drains emitted events, then rethrows a task failure', async () => {
    const got: string[] = [];
    const run = async () => {
      for await (const v of streamTasks<string>(
        [
          async (emit) => {
            emit('x');
            throw new Error('boom');
          },
          async (emit) => {
            await tick();
            emit('y');
          },
        ],
        2,
      )) {
        got.push(v);
      }
    };
    await expect(run()).rejects.toThrow('boom');
    expect(got.sort()).toEqual(['x', 'y']);
  });

  it('handles zero tasks', async () => {
    const out: unknown[] = [];
    for await (const v of streamTasks([], 3)) out.push(v);
    expect(out).toEqual([]);
  });
});
