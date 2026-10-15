import {
  AbortedError,
  BadResponseError,
  HttpError,
  NetworkError,
  ParcelLookupError,
  ServiceError,
  TimeoutError,
} from "./errors.js";
import type { Fetch, HttpGet } from "./types.js";

export interface HttpOptions {
  /** Defaults to the global `fetch`. Inject your own for proxies, tests or non-Node runtimes. */
  fetch?: Fetch;
  /** Per-attempt timeout. Default 10 000 ms. */
  timeoutMs?: number;
  /** Extra attempts after the first for timeouts, network errors, 429 and 5xx. Default 2. */
  retries?: number;
  /** Base delay for exponential backoff (doubles each retry, plus jitter). Default 300 ms. */
  retryBaseMs?: number;
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Sent as `User-Agent`. Broward's GIS server answers 403 to requests with no User-Agent (curl's default
   * included), so a descriptive one is always sent. Browsers ignore this header.
   */
  userAgent?: string;
  signal?: AbortSignal;
}

const DEFAULT_UA = "@27colab/fl-parcel-lookup (+https://github.com/27colab/fl-parcel-lookup)";
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class RetryableHttpError extends HttpError {
  retryAfterMs: number | undefined;
}

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  return Number.isFinite(secs) && secs >= 0 ? Math.min(secs * 1000, 30_000) : undefined;
}

export function createHttp(options: HttpOptions = {}): HttpGet {
  const doFetch: Fetch = options.fetch ?? ((...a) => globalThis.fetch(...a));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = Math.max(0, options.retries ?? 2);
  const base = options.retryBaseMs ?? 300;
  const sleep = options.sleep ?? defaultSleep;
  const ua = options.userAgent ?? DEFAULT_UA;

  async function once(url: string, endpoint: string): Promise<unknown> {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    const onAbort = () => ctrl.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const classify = (e: unknown): ParcelLookupError => {
      if (timedOut) return new TimeoutError(endpoint, timeoutMs);
      if (options.signal?.aborted) return new AbortedError();
      return e instanceof ParcelLookupError ? e : new NetworkError(endpoint, e);
    };
    try {
      let res: Response;
      try {
        res = await doFetch(url, { signal: ctrl.signal, headers: { "User-Agent": ua, Accept: "application/json" } });
      } catch (e) {
        throw classify(e);
      }
      if (!res.ok) {
        const err = new RetryableHttpError(endpoint, res.status);
        err.retryAfterMs = retryAfterMs(res);
        throw err;
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch (e) {
        const c = classify(e);
        throw c instanceof NetworkError ? new BadResponseError(endpoint, "body is not valid JSON") : c;
      }
      if (body && typeof body === "object" && "error" in body) {
        const e = (body as { error?: { code?: unknown; message?: unknown } }).error;
        throw new ServiceError(endpoint, typeof e?.code === "number" ? e.code : 0, String(e?.message ?? "unknown"));
      }
      return body;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  return async function get(endpoint, params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    qs.set("f", "json");
    const url = `${endpoint}?${qs.toString()}`;

    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) throw new AbortedError();
      try {
        return await once(url, endpoint);
      } catch (err) {
        if (!(err instanceof ParcelLookupError) || !err.retryable || attempt >= retries) throw err;
        const hinted = err instanceof RetryableHttpError ? err.retryAfterMs : undefined;
        await sleep(hinted ?? base * 2 ** attempt + Math.floor(Math.random() * base));
      }
    }
  };
}
