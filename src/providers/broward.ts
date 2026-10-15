import { joinLines, queryFeatures, sqlString, str, type Feature } from "../arcgis.js";
import { cleanFolio } from "../county.js";
import { runSearch, situsWhere } from "../match.js";
import type { CountyProvider, NormalizedAddress, ParcelRecord, ProviderContext } from "../types.js";

/** Broward County GIS address points: situs address -> folio, with coordinates. No legal description. */
export const BROWARD_ADDRESS_URL =
  "https://bcgishub.broward.org/server/rest/services/GeoHubDownloads/GISAddressPoints/FeatureServer/0";
/** Broward County Property Appraiser tax roll (MapServer layer): folio -> legal description, owner, situs parts. */
export const BROWARD_TAXROLL_URL =
  "https://bcgishub.broward.org/server/rest/services/GeoHubDownloads/BCGIS_Q_BCPA_Parcel_TaxRoll/MapServer/0";

const ADDR_FIELDS = ["FOLIONUMBER", "SITUSFULLADDRESS", "CITYNAME", "ZIPCODE", "LATITUDE", "LONGITUDE"];
const LEGAL_FIELDS = Array.from({ length: 14 }, (_, i) => `LEGAL_LINE_${i + 1}`);
const OWNER_FIELDS = ["NAME_LINE_1", "NAME_LINE_2"];
const SITUS_PARTS = [
  "SITUS_STREET_NUMBER", "SITUS_STREET_DIRECTION", "SITUS_STREET_NAME", "SITUS_STREET_TYPE",
  "SITUS_STREET_POST_DIR", "SITUS_UNIT_NUMBER",
];

interface TaxRollInfo {
  legal: string | null;
  owner?: string[];
  situs?: string;
}

async function taxRoll(folios: string[], ctx: ProviderContext): Promise<Map<string, TaxRollInfo>> {
  const out = new Map<string, TaxRollInfo>();
  const wantLegal = ctx.include.legal;
  if (folios.length === 0) return out;
  const fields = ["FOLIO", ...(wantLegal ? LEGAL_FIELDS : []), ...(ctx.include.owner ? OWNER_FIELDS : []), ...SITUS_PARTS];
  const features = await queryFeatures(ctx.http, BROWARD_TAXROLL_URL, {
    where: `FOLIO IN (${folios.map(sqlString).join(",")})`,
    outFields: fields,
    limit: Math.max(folios.length, 1),
  });
  for (const f of features) {
    const a = f.attributes;
    const folio = str(a["FOLIO"]);
    if (!folio) continue;
    const info: TaxRollInfo = { legal: wantLegal ? joinLines(LEGAL_FIELDS.map((k) => a[k])) : null };
    if (ctx.include.owner) {
      const owners = OWNER_FIELDS.map((k) => str(a[k])).filter((x): x is string => !!x);
      if (owners.length) info.owner = owners;
    }
    const situs = joinLines([
      a["SITUS_STREET_NUMBER"], a["SITUS_STREET_DIRECTION"], a["SITUS_STREET_NAME"], a["SITUS_STREET_TYPE"],
      a["SITUS_STREET_POST_DIR"], a["SITUS_UNIT_NUMBER"],
    ]);
    if (situs) info.situs = situs;
    out.set(cleanFolio(folio), info);
  }
  return out;
}

function toRecord(f: Feature, ctx: ProviderContext): ParcelRecord | undefined {
  const a = f.attributes;
  const folio = str(a["FOLIONUMBER"]);
  const situs = str(a["SITUSFULLADDRESS"]);
  if (!folio || !situs) return undefined;
  const rec: ParcelRecord = {
    folio: cleanFolio(folio),
    situs,
    legal: null,
    county: "broward",
    source: {
      county: "broward",
      dataset: "Broward County GIS: Address Points (+ BCPA Parcel TaxRoll for legal/owner)",
      url: BROWARD_ADDRESS_URL,
      retrievedAt: ctx.now().toISOString(),
    },
  };
  const lat = a["LATITUDE"];
  const lng = a["LONGITUDE"];
  if (typeof lat === "number" && typeof lng === "number") rec.coords = { lat, lng };
  return rec;
}

async function enrich(records: ParcelRecord[], ctx: ProviderContext): Promise<void> {
  if (!ctx.include.legal && !ctx.include.owner) return;
  const info = await taxRoll([...new Set(records.map((r) => r.folio))].slice(0, 25), ctx);
  for (const r of records) {
    const i = info.get(r.folio);
    if (!i) continue;
    r.legal = i.legal;
    if (i.owner) r.owner = i.owner;
  }
}

export const browardProvider: CountyProvider = {
  id: "broward",
  name: "Broward County",

  isValidFolio: (folio) => /^[0-9A-Z]{12}$/.test(cleanFolio(folio)),

  async searchByAddress(address: NormalizedAddress, ctx) {
    const lines = address.search["broward"];
    const records = await runSearch({
      address,
      lines,
      zipSupported: true,
      zipMode: ctx.zip,
      unitFallback: ctx.unitFallback,
      async fetchRows({ unit, zip }) {
        const extra = zip ? `ZIPCODE = ${sqlString(zip)}` : undefined;
        const features = await queryFeatures(ctx.http, BROWARD_ADDRESS_URL, {
          where: situsWhere("SITUSFULLADDRESS", lines, unit, extra),
          outFields: ADDR_FIELDS,
          limit: ctx.maxResults,
        });
        return features.map((f) => toRecord(f, ctx)).filter((r): r is ParcelRecord => !!r);
      },
    });
    await enrich(records, ctx);
    return records;
  },

  async getByFolio(folio, ctx) {
    const clean = cleanFolio(folio);
    const [points, roll] = await Promise.all([
      queryFeatures(ctx.http, BROWARD_ADDRESS_URL, {
        where: `FOLIONUMBER = ${sqlString(clean)}`,
        outFields: ADDR_FIELDS,
        limit: 5,
      }),
      taxRoll([clean], { ...ctx, include: { owner: ctx.include.owner, legal: true } }),
    ]);
    const info = roll.get(clean);
    let rec: ParcelRecord | undefined;
    for (const p of points) {
      rec = toRecord(p, ctx);
      if (rec) break;
    }
    if (!rec) {
      if (!info?.situs) return null;
      rec = {
        folio: clean,
        situs: info.situs,
        legal: null,
        county: "broward",
        source: {
          county: "broward",
          dataset: "Broward County GIS: BCPA Parcel TaxRoll",
          url: BROWARD_TAXROLL_URL,
          retrievedAt: ctx.now().toISOString(),
        },
      };
    }
    if (info) {
      rec.legal = ctx.include.legal ? info.legal : null;
      if (info.owner) rec.owner = info.owner;
    }
    return rec;
  },
};
