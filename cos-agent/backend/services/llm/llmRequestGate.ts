/** Begrenzt parallele Anthropic-Aufrufe und minimiert Burst-Rate-Limits. */

const MAX_CONCURRENT = 2;
const MIN_GAP_MS = 350;

let active = 0;
let lastStartMs = 0;
const waiters: Array<() => void> = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
}

export async function withLlmRequestGate<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    const gap = Date.now() - lastStartMs;
    if (lastStartMs > 0 && gap < MIN_GAP_MS) {
      await sleep(MIN_GAP_MS - gap);
    }
    lastStartMs = Date.now();
    return await fn();
  } finally {
    release();
  }
}

/** Nur für Tests: Gate zurücksetzen. */
export function resetLlmRequestGateForTests(): void {
  active = 0;
  lastStartMs = 0;
  waiters.length = 0;
}
