import { Channel } from './channel';
import { createLimiter } from './limit';

export async function* streamTasks<T>(
  tasks: Array<(emit: (v: T) => void) => Promise<void>>,
  concurrency: number,
): AsyncGenerator<T, void> {
  const channel = new Channel<T>();
  const limit = createLimiter(Math.max(1, concurrency));
  const emit = (v: T) => channel.push(v);
  const settled = Promise.allSettled(tasks.map((task) => limit(() => task(emit)))).then((results) => {
    channel.close();
    return results;
  });
  for await (const v of channel) yield v;
  const results = await settled;
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}
