import { BadResponseError } from "./errors.js";
import type { Coordinates, HttpGet } from "./types.js";

export interface Feature {
  attributes: Record<string, unknown>;
  centroid?: Coordinates;
}

/** Quote a string literal for an ArcGIS SQL `where`. */
export function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Trimmed, whitespace-collapsed non-empty string, or undefined. Numbers are stringified. */
export function str(v: unknown): string | undefined {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t === "" ? undefined : t;
}

export function joinLines(values: unknown[], sep = " "): string | null {
  const parts = values.map(str).filter((x): x is string => !!x);
  return parts.length ? parts.join(sep) : null;
}

export interface QueryParams {
  where: string;
  outFields: string[];
  /** Ask the server for the polygon centroid in WGS84 (hosted feature layers). */
  centroid?: boolean;
  limit: number;
}

export async function queryFeatures(http: HttpGet, endpoint: string, p: QueryParams): Promise<Feature[]> {
  const params: Record<string, string | number | boolean> = {
    where: p.where,
    outFields: p.outFields.join(","),
    returnGeometry: false,
    outSR: 4326,
    resultRecordCount: p.limit,
  };
  if (p.centroid) params["returnCentroid"] = true;
  const body = await http(`${endpoint}/query`, params);
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new BadResponseError(endpoint, "missing features array");
  const out: Feature[] = [];
  for (const f of features) {
    const attributes = (f as { attributes?: unknown } | null)?.attributes;
    if (!attributes || typeof attributes !== "object") continue;
    const feat: Feature = { attributes: attributes as Record<string, unknown> };
    const c = (f as { centroid?: { x?: unknown; y?: unknown } }).centroid;
    if (c && typeof c.x === "number" && typeof c.y === "number") feat.centroid = { lat: c.y, lng: c.x };
    out.push(feat);
  }
  return out;
}
