export function getAuthToken() {
  const current = new URL(window.location.href);
  const fromUrl = current.searchParams.get('token');
  if (fromUrl) {
    window.sessionStorage.setItem('wf-ui-token', fromUrl);
    return fromUrl;
  }
  return window.sessionStorage.getItem('wf-ui-token') || '';
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const token = getAuthToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(path, { ...init, headers });
}

export async function apiJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    let message = `${path}: ${res.status}`;
    try {
      const body = await res.json();
      message = body?.error?.message || message;
    } catch {
      // keep status message
    }
    throw new Error(message);
  }
  return res.json();
}

const jsonCache = new Map<string, { ts: number; value?: unknown; promise?: Promise<unknown> }>();

export async function apiJsonCached<T = any>(
  path: string,
  { ttlMs = 3000, refresh = false }: { ttlMs?: number; refresh?: boolean } = {},
): Promise<T> {
  const key = path;
  const now = Date.now();
  const cached = jsonCache.get(key);
  if (!refresh && cached) {
    if (cached.value !== undefined && now - cached.ts < ttlMs) return cached.value as T;
    if (cached.value !== undefined) {
      if (!cached.promise) {
        const promise = apiJson<T>(path)
          .then((value) => {
            jsonCache.set(key, { ts: Date.now(), value });
            return value;
          })
          .catch((error) => {
            jsonCache.set(key, { ts: cached.ts, value: cached.value });
            console.debug?.('Background refresh failed', path, error);
            return cached.value as T;
          });
        jsonCache.set(key, { ...cached, promise });
      }
      return cached.value as T;
    }
    if (cached.promise) return cached.promise as Promise<T>;
  }

  const promise = apiJson<T>(path)
    .then((value) => {
      jsonCache.set(key, { ts: Date.now(), value });
      return value;
    })
    .catch((error) => {
      jsonCache.delete(key);
      throw error;
    });
  jsonCache.set(key, { ts: now, promise });
  return promise;
}

export function invalidateApiCache(prefix?: string) {
  if (!prefix) {
    jsonCache.clear();
    return;
  }
  for (const key of [...jsonCache.keys()]) {
    if (key.startsWith(prefix)) jsonCache.delete(key);
  }
}

export function wsUrl(path: string) {
  const token = getAuthToken();
  const url = new URL(path, window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
}
