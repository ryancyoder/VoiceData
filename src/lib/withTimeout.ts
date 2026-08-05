/**
 * Races a promise against a timeout, rejecting if it doesn't settle in
 * time. Used to guard third-party calls (EXIF parsing, geocoding, etc.)
 * that can occasionally hang on unusual input instead of rejecting —
 * without this, one bad file/response can stall an entire batch.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * fetch() with a timeout, using a manually-managed AbortController rather
 * than AbortSignal.timeout() (a newer API, Safari 16+) for the widest
 * compatibility.
 */
export async function fetchWithTimeout(input: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
