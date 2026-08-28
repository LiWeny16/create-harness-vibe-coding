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
    let detail: Record<string, unknown> | undefined;
    try {
      const body = await res.json();
      // Typed rejection bodies (agent-team-cooperation-spec §6.2/§7/§8): the
      // error field may be a string code with a sibling `message` + detail
      // fields (goal_already_bound) or an object { code, message } with
      // sibling detail fields (goal_items_pending, markdown_conflict). Keep
      // the backend message and attach the detail fields for typed consumers.
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const record = body as Record<string, unknown>;
        const errorPart = record.error;
        if (errorPart && typeof errorPart === 'object') {
          const err = errorPart as Record<string, unknown>;
          if (typeof err.message === 'string') message = err.message;
        } else if (typeof record.message === 'string') {
          message = record.message;
        }
        for (const field of ['remaining', 'existingGoalNodeId', 'timerNodeId', 'currentRevision', 'expectedRevision', 'holder', 'expiresAt']) {
          if (Object.prototype.hasOwnProperty.call(record, field)) {
            detail = detail || {};
            detail[field] = record[field];
          }
        }
      }
    } catch {
      // keep status message
    }
    const error = new Error(message) as Error & { detail?: Record<string, unknown> };
    if (detail) error.detail = detail;
    throw error;
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
      // Stale entry: await the refresh instead of serving stale data that is
      // about to be replaced. Cap the wait at 1500ms; on timeout or refresh
      // failure fall back to the stale value (never throw when one exists).
      try {
        return await Promise.race([
          cached.promise as Promise<T>,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('refresh timeout')), 1500);
          }),
        ]);
      } catch {
        return cached.value as T;
      }
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
