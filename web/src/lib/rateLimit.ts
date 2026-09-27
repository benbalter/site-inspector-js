const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const MAX_CONCURRENT_INSPECTIONS = 3;

let windowStartedAt = Date.now();
let requestsInWindow = 0;
let activeInspections = 0;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Apply a per-process admission limit suitable for a single low-volume demo instance. */
export function admitInspection(now = Date.now()): RateLimitResult {
  if (now - windowStartedAt >= WINDOW_MS) {
    windowStartedAt = now;
    requestsInWindow = 0;
  }

  if (requestsInWindow >= MAX_REQUESTS_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt + WINDOW_MS - now) / 1000)),
    };
  }

  requestsInWindow++;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Limit simultaneous scans to avoid saturating a small free instance. */
export function acquireInspectionSlot(): (() => void) | null {
  if (activeInspections >= MAX_CONCURRENT_INSPECTIONS) return null;

  activeInspections++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeInspections--;
  };
}
