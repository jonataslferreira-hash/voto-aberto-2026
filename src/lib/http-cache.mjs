// Cache is isolated by fetch implementation so tests never reuse production responses.
const stores = new WeakMap();
function storeFor(fetchImpl) {
  if (!stores.has(fetchImpl))
    stores.set(fetchImpl, {
      entries: new Map(),
      pending: new Map(),
      cooldown: new Map(),
    });
  return stores.get(fetchImpl);
}
const defaultStore = () => storeFor(fetch);
export function getCached(key) {
  const item = defaultStore().entries.get(key);
  return item && Date.now() < item.expiresAt ? item : null;
}
export function setCached(key, value, ttlMs, meta = {}) {
  const item = { value, expiresAt: Date.now() + ttlMs, ...meta };
  defaultStore().entries.set(key, item);
  return item;
}
let active = 0;
const queue = [];
async function limited(task) {
  if (active >= 4) await new Promise((resolve) => queue.push(resolve));
  active++;
  try {
    return await task();
  } finally {
    active--;
    queue.shift()?.();
  }
}
function retryDelay(value, attempt) {
  const seconds = value === null ? NaN : Number(value);
  const duration = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(duration) && duration > 0
    ? duration
    : (attempt + 1) * 500;
}
export async function fetchWithPolicy({
  key,
  url,
  timeoutMs = 5000,
  cacheTtlMs = 30000,
  maxRetries = 2,
  fetchImpl = fetch,
  responseType = "json",
}) {
  const store = storeFor(fetchImpl);
  const cacheKey = `${key}|${url}|${responseType}`;
  const cached = store.entries.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt)
    return { data: cached.value, fetchedAt: cached.fetchedAt, fromCache: true };
  if (store.pending.has(cacheKey)) return store.pending.get(cacheKey);
  const cooldown = store.cooldown.get(cacheKey);
  if (cooldown && Date.now() < cooldown.until)
    throw new Error(cooldown.message);
  const request = limited(async () => {
    const headers = {};
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    if (cached?.lastModified)
      headers["If-Modified-Since"] = cached.lastModified;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let delay = 0;
      try {
        const response = await fetchImpl(url, {
          headers,
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 304 && cached) {
          cached.expiresAt = Date.now() + cacheTtlMs;
          cached.fetchedAt = new Date().toISOString();
          return {
            data: cached.value,
            fetchedAt: cached.fetchedAt,
            response,
            fromCache: true,
          };
        }
        if (!response.ok) {
          const error = new Error(
            `HTTP ${response.status} ao consultar ${url}`,
          );
          error.retryable = response.status === 429 || response.status >= 500;
          delay = retryDelay(response.headers.get("retry-after"), attempt);
          error.cooldownMs = delay;
          throw error;
        }
        const data =
          responseType === "text"
            ? await response.text()
            : await response.json();
        const fetchedAt = new Date().toISOString();
        store.entries.set(cacheKey, {
          value: data,
          fetchedAt,
          expiresAt: Date.now() + cacheTtlMs,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
        });
        store.cooldown.delete(cacheKey);
        return { data, fetchedAt, response, fromCache: false };
      } catch (error) {
        const retryable =
          error.retryable ??
          (error.name === "TimeoutError" ||
            error.name === "AbortError" ||
            error instanceof TypeError);
        if (!retryable || attempt >= maxRetries || delay > 1500) {
          const message = `${error.message}${error.cause?.code ? ` (${error.cause.code})` : ""}`;
          store.cooldown.set(cacheKey, {
            until: Date.now() + Math.max(cacheTtlMs, error.cooldownMs || 0),
            message,
          });
          throw new Error(message);
        }
        // Release response before a short, bounded retry. Long Retry-After is a cooldown.
        await new Promise((resolve) =>
          setTimeout(resolve, delay || (attempt + 1) * 500),
        );
      }
    }
  });
  store.pending.set(cacheKey, request);
  try {
    return await request;
  } finally {
    store.pending.delete(cacheKey);
  }
}
