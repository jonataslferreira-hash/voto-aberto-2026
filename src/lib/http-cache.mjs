const cache = new Map();
const cooldownUntil = new Map();

function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, at - Date.now());
}

export function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item;
}

export function setCached(key, value, ttlMs, meta = {}) {
  const entry = {
    value,
    expiresAt: Date.now() + ttlMs,
    etag: meta.etag ?? null,
    lastModified: meta.lastModified ?? null
  };
  cache.set(key, entry);
  return entry;
}

export async function fetchWithPolicy({
  key,
  url,
  timeoutMs = 5000,
  cacheTtlMs = 30000,
  maxRetries = 2,
  fetchImpl = fetch
}) {
  const waitUntil = cooldownUntil.get(key);
  if (waitUntil && Date.now() < waitUntil) {
    throw new Error(`Fonte em cooldown até ${new Date(waitUntil).toISOString()}`);
  }

  const cached = getCached(key);
  const headers = {};
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        headers,
        redirect: 'follow',
        signal: controller.signal
      });

      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      if (response.status === 304 && cached) {
        cached.expiresAt = Date.now() + cacheTtlMs;
        return { data: cached.value, response, fromCache: true };
      }

      if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
        const backoffMs = retryAfterMs || (attempt + 1) * 500;
        cooldownUntil.set(key, Date.now() + backoffMs);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ao consultar ${url}`);
      }

      const data = await response.json();
      const entry = setCached(key, data, cacheTtlMs, {
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified')
      });
      return { data: entry.value, response, fromCache: false };
    } catch (error) {
      if (error.name === 'AbortError') {
        if (attempt < maxRetries) continue;
        throw new Error(`Timeout (${timeoutMs}ms) ao consultar ${url}`);
      }
      if (attempt >= maxRetries) throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Falha inesperada ao consultar ${url}`);
}
