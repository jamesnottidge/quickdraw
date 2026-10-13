export const DEFAULT_TIMEOUT_MS = 30_000;
/** Max silence on a streaming response. Muse sends keepalive comments while it reasons, which reset this. */
export const DEFAULT_IDLE_MS = 45_000;

/** Aborts after `ms` (TimeoutError), or sooner if the outer signal (the run time limit) aborts (AbortError). */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
