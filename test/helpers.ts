import { readFileSync } from "node:fs";
import type { Fetch } from "../src/index.js";

export function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as T;
}

export interface Call {
  endpoint: string;
  params: URLSearchParams;
  headers: Record<string, string>;
}

type Handler = (call: Call) => unknown;

/** A fetch stand-in that routes by endpoint substring and records every request. */
export function fakeFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fn: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      endpoint: `${url.origin}${url.pathname}`,
      params: url.searchParams,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const key = Object.keys(routes).find((k) => call.endpoint.includes(k));
    if (!key) throw new Error(`unrouted request: ${call.endpoint}`);
    const out = routes[key]!(call);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: fn, calls };
}

export const noSleep = async () => {};
export const fixedNow = () => new Date("2026-01-01T00:00:00.000Z");
