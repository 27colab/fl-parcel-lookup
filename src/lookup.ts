import { normalizeAddress } from "./address.js";
import { cleanFolio, detectCountyFromFolio } from "./county.js";
import { InvalidFolioError, UnsupportedCountyError } from "./errors.js";
import { createHttp, type HttpOptions } from "./http.js";
import { browardProvider, miamiDadeProvider, palmBeachProvider } from "./providers/index.js";
import {
  COUNTY_IDS,
  type AddressInput,
  type CountyId,
  type CountyProvider,
  type ParcelRecord,
  type ProviderContext,
} from "./types.js";

export interface LookupOptions extends HttpOptions {
  /** Skip detection and force a county. */
  county?: CountyId;
  /** Include owner names (public record). Default false: owner fields are not even requested. */
  includeOwner?: boolean;
  /** Include the legal description. Default true. Broward needs a second request for it. */
  includeLegal?: boolean;
  /** "prefer" (default): filter by ZIP, retry without if nothing matched. */
  zip?: "prefer" | "require" | "ignore";
  /** When a unit isn't found, return street-level matches flagged `unitMatched: false`. Default false. */
  unitFallback?: boolean;
  /** Max rows requested per query. Default 50. */
  maxResults?: number;
  /** Replace or add providers (e.g. a stub or a proxy-backed one). */
  providers?: CountyProvider[];
  now?: () => Date;
}

export interface Client {
  /** Best match for an address, or null. Check `ambiguous` / `unitMatched` on the result. */
  lookupByAddress(input: AddressInput, overrides?: Partial<LookupOptions>): Promise<ParcelRecord | null>;
  /** Every distinct parcel matching the street line (e.g. all units of a condo building). */
  searchByAddress(input: AddressInput, overrides?: Partial<LookupOptions>): Promise<ParcelRecord[]>;
  lookupByFolio(folio: string, overrides?: Partial<LookupOptions>): Promise<ParcelRecord | null>;
}

const BUILT_IN: CountyProvider[] = [miamiDadeProvider, browardProvider, palmBeachProvider];

export function createClient(defaults: LookupOptions = {}): Client {
  const resolve = (o: Partial<LookupOptions> | undefined) => {
    const opts = { ...defaults, ...o };
    const providers = new Map<CountyId, CountyProvider>();
    for (const p of [...BUILT_IN, ...(opts.providers ?? [])]) providers.set(p.id, p);
    const ctx: ProviderContext = {
      http: createHttp(opts),
      include: { owner: opts.includeOwner ?? false, legal: opts.includeLegal ?? true },
      zip: opts.zip ?? "prefer",
      unitFallback: opts.unitFallback ?? false,
      maxResults: opts.maxResults ?? 50,
      now: opts.now ?? (() => new Date()),
    };
    return { opts, providers, ctx };
  };

  async function search(input: AddressInput, overrides?: Partial<LookupOptions>): Promise<ParcelRecord[]> {
    const { opts, providers, ctx } = resolve(overrides);
    const address = normalizeAddress(input, opts.county ? { county: opts.county } : {});
    const county = address.county;
    if (!county) {
      throw new UnsupportedCountyError(
        "Could not determine the county; pass `county` or a Places result with administrative_area_level_2",
      );
    }
    const provider = providers.get(county);
    if (!provider) throw new UnsupportedCountyError(`No provider for ${county}`, county);
    const records = await provider.searchByAddress(address, ctx);
    // Exact situs (no trailing unit text) first, then by folio for a stable order.
    const lines = address.search[county];
    const exact = (r: ParcelRecord) => (lines.includes(r.situs.toUpperCase()) ? 1 : 0);
    return records.sort((a, b) => exact(b) - exact(a) || a.folio.localeCompare(b.folio));
  }

  return {
    searchByAddress: search,

    async lookupByAddress(input, overrides) {
      const records = await search(input, overrides);
      const best = records[0];
      if (!best) return null;
      const folios = new Set(records.map((r) => r.folio));
      return {
        ...best,
        candidates: folios.size,
        ambiguous: folios.size > 1 && best.unitMatched !== true,
      };
    },

    async lookupByFolio(folio, overrides) {
      const { opts, providers, ctx } = resolve(overrides);
      const clean = cleanFolio(folio);
      const county = opts.county ?? detectCountyFromFolio(clean);
      if (!county || !COUNTY_IDS.includes(county)) {
        throw new InvalidFolioError("Could not tell which county this folio belongs to; pass `county`");
      }
      const provider = providers.get(county);
      if (!provider) throw new UnsupportedCountyError(`No provider for ${county}`, county);
      if (!provider.isValidFolio(clean)) {
        throw new InvalidFolioError(`Folio does not look like a ${provider.name} folio`);
      }
      return provider.getByFolio(clean, ctx);
    },
  };
}

const defaultClient = createClient();

export const lookupByAddress: Client["lookupByAddress"] = (i, o) => defaultClient.lookupByAddress(i, o);
export const searchByAddress: Client["searchByAddress"] = (i, o) => defaultClient.searchByAddress(i, o);
export const lookupByFolio: Client["lookupByFolio"] = (f, o) => defaultClient.lookupByFolio(f, o);
