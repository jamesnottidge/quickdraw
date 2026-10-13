export function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = () =>
    active < max ? (active++, Promise.resolve()) : new Promise<void>((resolve) => waiting.push(resolve));
  const release = () => {
    const next = waiting.shift();
    if (next) next(); // hand the slot straight to the next waiter
    else active--;
  };
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
