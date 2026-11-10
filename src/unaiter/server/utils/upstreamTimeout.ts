/**
 * Upstream fetch deadline (ms). Default `0` disables AbortSignal — same idea as
 * dns01-proxy `PROXY_UPSTREAM_TIMEOUT_MS` — so slow local AI streams are not
 * killed by a wall clock. Set `UNAITER_UPSTREAM_TIMEOUT_MS` to opt in.
 */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 0

export function upstreamTimeoutMs(): number {
  const raw = process.env.UNAITER_UPSTREAM_TIMEOUT_MS
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_UPSTREAM_TIMEOUT_MS
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_UPSTREAM_TIMEOUT_MS
  }
  return Math.floor(value)
}

/** `undefined` when disabled so fetch has no abort deadline. */
export function upstreamAbortSignal(): AbortSignal | undefined {
  const timeoutMs = upstreamTimeoutMs()
  return timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
}
