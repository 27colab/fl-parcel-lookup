import { sqlString } from "./arcgis.js";
import type { NormalizedAddress, ParcelRecord } from "./types.js";

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * `UPPER(col) LIKE ...` for every street-line variant. With a unit, the unit's alphanumeric runs must
 * follow the street line (the counties append the unit to the situs string). Street lines and units
 * contain only [A-Z0-9 '&/-], so no LIKE wildcard can come from user input.
 */
export function situsWhere(col: string, lines: string[], unit: string | undefined, extra?: string): string {
  const unitPattern = unit ? `%${unit.split(/[^A-Z0-9]+/).filter(Boolean).join("%")}%` : "";
  const ors = lines.map((l) => `UPPER(${col}) LIKE ${sqlString(unit ? `${l} ${unitPattern}` : `${l}%`)}`);
  return `(${ors.join(" OR ")})${extra ? ` AND ${extra}` : ""}`;
}

/**
 * Client-side check that a stored situs is the requested street line (and unit). Needed because
 * `LIKE 'x%'` also matches longer names ("7 ST" vs "7 STATION RD") and unit text is free-form.
 */
export function matchSitus(situs: string, lines: string[], unit: string | undefined): boolean {
  const s = situs.toUpperCase().replace(/\s+/g, " ").trim();
  for (const l of lines) {
    if (s === l) return !unit;
    if (!s.startsWith(`${l} `)) continue;
    return unit ? alnum(s.slice(l.length)) === alnum(unit) : true;
  }
  return false;
}

export function dedupeByFolio(records: ParcelRecord[]): ParcelRecord[] {
  const seen = new Map<string, ParcelRecord>();
  for (const r of records) {
    const prev = seen.get(r.folio);
    if (!prev || (!prev.coords && r.coords)) seen.set(r.folio, r);
  }
  return [...seen.values()];
}

export interface RunSearchArgs {
  address: NormalizedAddress;
  lines: string[];
  fetchRows: (opts: { unit: string | undefined; zip: string | undefined }) => Promise<ParcelRecord[]>;
  zipSupported: boolean;
  zipMode: "prefer" | "require" | "ignore";
  unitFallback: boolean;
}

/**
 * Shared search flow: query with ZIP (when the service has a situs ZIP), retry without it, filter
 * client-side, then optionally fall back from "street + unit" to "street only".
 */
export async function runSearch(a: RunSearchArgs): Promise<ParcelRecord[]> {
  const { address } = a;
  const keep = (rows: ParcelRecord[], unit: string | undefined) =>
    dedupeByFolio(rows.filter((r) => matchSitus(r.situs, a.lines, unit)));

  const attempt = async (unit: string | undefined): Promise<ParcelRecord[]> => {
    const useZip = a.zipSupported && a.zipMode !== "ignore" && !!address.zip;
    let kept = keep(await a.fetchRows({ unit, zip: useZip ? address.zip : undefined }), unit);
    if (kept.length === 0 && useZip && a.zipMode === "prefer") {
      kept = keep(await a.fetchRows({ unit, zip: undefined }), unit);
    }
    if (unit) for (const r of kept) r.unitMatched = true;
    return kept;
  };

  const found = await attempt(address.unit);
  if (found.length > 0 || !address.unit || !a.unitFallback) return found;
  const street = await attempt(undefined);
  for (const r of street) r.unitMatched = false;
  return street;
}
