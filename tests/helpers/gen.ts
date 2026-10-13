export async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<{ events: T[]; result: R }> {
  const events: T[] = [];
  for (;;) {
    const n = await gen.next();
    if (n.done) return { events, result: n.value };
    events.push(n.value);
  }
}
