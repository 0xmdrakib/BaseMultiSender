import { isIP } from "node:net";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds?: number;
};

type Counter = {
  startedAt: number;
  count: number;
};

type ClientRateState = {
  burst: Counter;
  sustained: Counter;
  blockedUntil: number;
  lastSeen: number;
};

type StoreState = {
  entries: Map<string, ClientRateState>;
  lastCleanup: number;
};

type IpRateLimiterConfig = {
  namespace: string;
  cloudflareHosts: readonly string[];
  burst: { windowMs: number; max: number };
  sustained: { windowMs: number; max: number };
  burstBlockMs: number;
  idleTtlMs?: number;
  cleanupIntervalMs?: number;
  maxEntries?: number;
};

const rateLimitGlobal = globalThis as typeof globalThis & {
  __ipRateLimitStores?: Map<string, StoreState>;
};

const stores =
  rateLimitGlobal.__ipRateLimitStores ??
  (rateLimitGlobal.__ipRateLimitStores = new Map<string, StoreState>());

function normalizeIp(value: string | null) {
  if (!value) return null;

  let candidate = value.split(",", 1)[0]?.trim() ?? "";
  if (candidate.startsWith("[")) {
    const closingBracket = candidate.indexOf("]");
    if (closingBracket > 0) candidate = candidate.slice(1, closingBracket);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/u.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  candidate = candidate.split("%", 1)[0] ?? "";
  return isIP(candidate) ? candidate.toLowerCase() : null;
}

export function requestHostname(req: Request) {
  const value = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return value.split(",", 1)[0]?.trim().toLowerCase() ?? "";
}

function clientKey(req: Request, cloudflareHosts: ReadonlySet<string>) {
  const hostname = requestHostname(req).replace(/:\d+$/u, "");
  if (cloudflareHosts.has(hostname)) {
    const cloudflareIp = normalizeIp(req.headers.get("cf-connecting-ip"));
    if (cloudflareIp) return `ip:${cloudflareIp}`;
  }

  const vercelIp =
    normalizeIp(req.headers.get("x-vercel-forwarded-for")) ??
    normalizeIp(req.headers.get("x-forwarded-for")) ??
    normalizeIp(req.headers.get("x-real-ip"));

  // Production Vercel requests have an IP header. A shared fallback bucket is
  // safer than allowing unlimited traffic if an intermediate proxy omits it.
  return `ip:${vercelIp ?? "unknown"}`;
}

function refreshCounter(counter: Counter, now: number, windowMs: number): Counter {
  if (now - counter.startedAt >= windowMs) return { startedAt: now, count: 0 };
  return counter;
}

export function createIpRateLimiter(config: IpRateLimiterConfig) {
  const cloudflareHosts = new Set(config.cloudflareHosts.map((host) => host.toLowerCase()));
  const idleTtlMs = config.idleTtlMs ?? 20 * 60_000;
  const cleanupIntervalMs = config.cleanupIntervalMs ?? 60_000;
  const maxEntries = Math.max(100, config.maxEntries ?? 10_000);
  const overflowKey = `${config.namespace}:overflow`;

  const store =
    stores.get(config.namespace) ??
    ({ entries: new Map<string, ClientRateState>(), lastCleanup: 0 } satisfies StoreState);
  stores.set(config.namespace, store);

  function touch(key: string, state: ClientRateState) {
    if (store.entries.has(key)) store.entries.delete(key);
    store.entries.set(key, state);
  }

  function cleanup(now: number) {
    if (now - store.lastCleanup < cleanupIntervalMs) return;
    store.lastCleanup = now;

    for (const [key, state] of store.entries) {
      if (now - state.lastSeen >= idleTtlMs && now >= state.blockedUntil) {
        store.entries.delete(key);
      }
    }

    while (store.entries.size > maxEntries) {
      const oldestKey = store.entries.keys().next().value;
      if (typeof oldestKey !== "string") break;
      store.entries.delete(oldestKey);
    }
  }

  function consume(req: Request, cost: number): RateLimitResult {
    const now = Date.now();
    cleanup(now);

    const requestedKey = clientKey(req, cloudflareHosts);
    const effectiveKey =
      store.entries.has(requestedKey) || store.entries.size < maxEntries - 1
        ? requestedKey
        : overflowKey;

    const existing = store.entries.get(effectiveKey);
    const state: ClientRateState = existing ?? {
      burst: { startedAt: now, count: 0 },
      sustained: { startedAt: now, count: 0 },
      blockedUntil: 0,
      lastSeen: now,
    };

    state.burst = refreshCounter(state.burst, now, config.burst.windowMs);
    state.sustained = refreshCounter(state.sustained, now, config.sustained.windowMs);
    state.lastSeen = now;

    if (state.blockedUntil > now) {
      touch(effectiveKey, state);
      return {
        allowed: false,
        limit: config.sustained.max,
        remaining: 0,
        resetAt: state.blockedUntil,
        retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)),
      };
    }

    const normalizedCost = Math.max(1, Math.ceil(cost));
    const burstExceeded = state.burst.count + normalizedCost > config.burst.max;
    const sustainedExceeded = state.sustained.count + normalizedCost > config.sustained.max;

    if (burstExceeded || sustainedExceeded) {
      const sustainedResetAt = state.sustained.startedAt + config.sustained.windowMs;
      state.blockedUntil = sustainedExceeded
        ? sustainedResetAt
        : Math.max(now + config.burstBlockMs, state.burst.startedAt + config.burst.windowMs);
      touch(effectiveKey, state);

      return {
        allowed: false,
        limit: config.sustained.max,
        remaining: Math.max(0, config.sustained.max - state.sustained.count),
        resetAt: state.blockedUntil,
        retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)),
      };
    }

    state.burst.count += normalizedCost;
    state.sustained.count += normalizedCost;
    touch(effectiveKey, state);

    return {
      allowed: true,
      limit: config.sustained.max,
      remaining: Math.max(0, config.sustained.max - state.sustained.count),
      resetAt: state.sustained.startedAt + config.sustained.windowMs,
    };
  }

  return { consume };
}

export function rateLimitHeaders(result: RateLimitResult) {
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(result.limit),
    "x-ratelimit-remaining": String(result.remaining),
    "x-ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
  };
  if (result.retryAfterSeconds) headers["retry-after"] = String(result.retryAfterSeconds);
  return headers;
}
