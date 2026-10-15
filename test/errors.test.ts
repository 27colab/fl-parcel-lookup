import { describe, expect, it, vi } from "vitest";
import {
  AbortedError,
  BadResponseError,
  HttpError,
  NetworkError,
  ParcelLookupError,
  ServiceError,
  TimeoutError,
  createClient,
  createHttp,
  type Fetch,
} from "../src/index.js";
import { fakeFetch, fixture, noSleep } from "./helpers.js";

const ENDPOINT = "https://example.test/arcgis/FeatureServer/0/query";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("createHttp", () => {
  it("times out when the server never answers, and aborts the request", async () => {
    let aborted = false;
    const hang: Fetch = (_u, init) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          rej(new DOMException("aborted", "AbortError"));
        });
      });
    const get = createHttp({ fetch: hang, timeoutMs: 20, retries: 0 });
    const err: any = await get(ENDPOINT, {}).catch((e: any) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).toMatchObject({ code: "TIMEOUT", retryable: true, timeoutMs: 20 });
    expect(aborted).toBe(true);
  });

  it("retries timeouts then succeeds", async () => {
    let n = 0;
    const flaky: Fetch = (_u, init) => {
      if (++n < 3) return new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("x"))));
      return Promise.resolve(json({ features: [] }));
    };
    const sleeps: number[] = [];
    const get = createHttp({ fetch: flaky, timeoutMs: 10, retries: 2, retryBaseMs: 100, sleep: async (ms) => void sleeps.push(ms) });
    expect(await get(ENDPOINT, {})).toEqual({ features: [] });
    expect(n).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(100);
    expect(sleeps[1]).toBeGreaterThanOrEqual(200); // exponential
  });

  it("gives up after retries and reports the last error", async () => {
    const f = vi.fn<Fetch>(async () => json({}, 503));
    const err: any = await createHttp({ fetch: f, retries: 2, sleep: noSleep })(ENDPOINT, {}).catch((e: any) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(503);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("wraps network failures", async () => {
    const f: Fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const err: any = await createHttp({ fetch: f, retries: 0 })(ENDPOINT, {}).catch((e: any) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.retryable).toBe(true);
    expect((err.cause as Error).message).toBe("fetch failed");
  });

  it("honours Retry-After on 429", async () => {
    const responses = [json({}, 429, { "retry-after": "2" }), json({ features: [] })];
    const sleeps: number[] = [];
    const get = createHttp({ fetch: async () => responses.shift()!, retries: 1, sleep: async (ms) => void sleeps.push(ms) });
    await get(ENDPOINT, {});
    expect(sleeps).toEqual([2000]);
  });

  it("does not retry 4xx", async () => {
    const f = vi.fn<Fetch>(async () => json({}, 404));
    const err: any = await createHttp({ fetch: f, retries: 3, sleep: noSleep })(ENDPOINT, {}).catch((e: any) => e);
    expect(err).toMatchObject({ code: "HTTP", status: 404, retryable: false });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("explains a 403 (Broward without a User-Agent)", async () => {
    const err: any = await createHttp({ fetch: async () => json({}, 403), retries: 0 })(ENDPOINT, {}).catch((e: any) => e);
    expect(err.message).toMatch(/User-Agent/);
  });

  it("turns an ArcGIS error body into ServiceError; 5xx codes retry, 4xx do not", async () => {
    const f400 = vi.fn<Fetch>(async () => json({ error: { code: 400, message: "Unable to complete operation." } }));
    const e400: any = await createHttp({ fetch: f400, retries: 2, sleep: noSleep })(ENDPOINT, {}).catch((e: any) => e);
    expect(e400).toBeInstanceOf(ServiceError);
    expect(e400).toMatchObject({ serviceCode: 400, retryable: false });
    expect(f400).toHaveBeenCalledTimes(1);

    const f504 = vi.fn<Fetch>(async () => json({ error: { code: 504, message: "Gateway timeout" } }));
    await createHttp({ fetch: f504, retries: 2, sleep: noSleep })(ENDPOINT, {}).catch(() => {});
    expect(f504).toHaveBeenCalledTimes(3);
  });

  it("rejects non-JSON bodies", async () => {
    const f: Fetch = async () => new Response("<html>maintenance</html>", { status: 200 });
    const err: any = await createHttp({ fetch: f, retries: 0 })(ENDPOINT, {}).catch((e: any) => e);
    expect(err).toBeInstanceOf(BadResponseError);
  });

  it("stops when the caller aborts", async () => {
    const ctrl = new AbortController();
    const f: Fetch = (_u, init) =>
      new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    const p = createHttp({ fetch: f, signal: ctrl.signal, timeoutMs: 5000, retries: 3, sleep: noSleep })(ENDPOINT, {});
    setTimeout(() => ctrl.abort(), 10);
    expect(await p.catch((e: any) => e)).toBeInstanceOf(AbortedError);
  });

  it("rejects immediately when already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const f = vi.fn<Fetch>();
    expect(await createHttp({ fetch: f, signal: ctrl.signal })(ENDPOINT, {}).catch((e: any) => e)).toBeInstanceOf(AbortedError);
    expect(f).not.toHaveBeenCalled();
  });

  it("keeps the query string out of error messages", async () => {
    const err: any = await createHttp({ fetch: async () => json({}, 500), retries: 0 })(ENDPOINT, { where: "SITUS LIKE 'SECRET%'" }).catch((e: any) => e);
    expect(err.message).not.toContain("SECRET");
    expect(err.endpoint).toBe(ENDPOINT);
  });

  it("always adds f=json and the User-Agent", async () => {
    const { fetch, calls } = fakeFetch({ example: () => ({ features: [] }) });
    await createHttp({ fetch, userAgent: "test-agent/1" })(ENDPOINT, { where: "1=1" });
    expect(calls[0]!.params.get("f")).toBe("json");
    expect(calls[0]!.headers["User-Agent"]).toBe("test-agent/1");
  });
});

describe("errors through the client", () => {
  it("surfaces a typed error from lookupByAddress", async () => {
    const { fetch } = fakeFetch({ PaParcelView: () => json({ error: { code: 400, message: "bad" } }) });
    const err: any = await createClient({ fetch, retries: 0, sleep: noSleep }).lookupByAddress("100 NW 7th St, Miami, FL").catch((e: any) => e);
    expect(err).toBeInstanceOf(ParcelLookupError);
    expect(err.code).toBe("SERVICE");
  });

  it("rejects a response with no features array", async () => {
    const { fetch } = fakeFetch({ PaParcelView: () => ({ nope: true }) });
    const err: any = await createClient({ fetch, retries: 0 }).lookupByAddress("100 NW 7th St, Miami, FL").catch((e: any) => e);
    expect(err).toBeInstanceOf(BadResponseError);
  });

  it("skips malformed features instead of crashing", async () => {
    const { fetch } = fakeFetch({ PaParcelView: () => ({ features: [null, {}, { attributes: null }, ...fixture("miami-dade").street.features] }) });
    const r = await createClient({ fetch, retries: 0 }).lookupByAddress("100 NW 7th St, Miami, FL");
    expect(r?.folio).toBe("0100000000010");
  });

  it("a mid-flight failure in Broward's second request is an error, not a half result", async () => {
    const fx = fixture("broward");
    const { fetch } = fakeFetch({ GISAddressPoints: () => fx.points, BCPA_Parcel_TaxRoll: () => json({}, 500) });
    const err: any = await createClient({ fetch, retries: 0 }).lookupByAddress("300 NW 58th Ave, Sampleville, Broward County, FL").catch((e: any) => e);
    expect(err).toBeInstanceOf(HttpError);
  });
});
