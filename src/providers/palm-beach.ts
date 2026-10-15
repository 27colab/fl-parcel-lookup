import { joinLines, queryFeatures, sqlString, str, type Feature } from "../arcgis.js";
import { cleanFolio } from "../county.js";
import { runSearch, situsWhere } from "../match.js";
import type { CountyProvider, NormalizedAddress, ParcelRecord, ProviderContext } from "../types.js";

/** Palm Beach County GIS, "Parcels and Property Details" (parcel polygons joined to property appraiser data). */
export const PALM_BEACH_URL =
  "https://services1.arcgis.com/ZWOoUZbtaYePLlPw/arcgis/rest/services/Parcels_and_Property_Details_WebMercator/FeatureServer/0";

// Note: CITYNAME and ZIP1 in this layer are the owner's MAILING city/ZIP, not the situs, so they are never
// used to filter. MUNICIPALITY is the situs municipality but is empty for unincorporated parcels.
const BASE_FIELDS = ["PARCEL_NUMBER", "SITE_ADDR_STR", "LEGAL1", "LEGAL2", "LEGAL3"];
const OWNER_FIELDS = ["OWNER_NAME1", "OWNER_NAME2"];

function toRecord(f: Feature, ctx: ProviderContext): ParcelRecord | undefined {
  const a = f.attributes;
  const folio = str(a["PARCEL_NUMBER"]);
  const situs = str(a["SITE_ADDR_STR"]);
  if (!folio || !situs) return undefined;
  const rec: ParcelRecord = {
    folio: cleanFolio(folio),
    situs,
    legal: ctx.include.legal ? joinLines([a["LEGAL1"], a["LEGAL2"], a["LEGAL3"]]) : null,
    county: "palm-beach",
    source: {
      county: "palm-beach",
      dataset: "Palm Beach County GIS: Parcels and Property Details",
      url: PALM_BEACH_URL,
      retrievedAt: ctx.now().toISOString(),
    },
  };
  if (f.centroid) rec.coords = f.centroid;
  if (ctx.include.owner) {
    const owners = OWNER_FIELDS.map((k) => str(a[k])).filter((x): x is string => !!x);
    if (owners.length) rec.owner = owners;
  }
  return rec;
}

export const palmBeachProvider: CountyProvider = {
  id: "palm-beach",
  name: "Palm Beach County",

  isValidFolio: (folio) => /^\d{17}$/.test(cleanFolio(folio)),

  searchByAddress(address: NormalizedAddress, ctx) {
    const outFields = ctx.include.owner ? [...BASE_FIELDS, ...OWNER_FIELDS] : BASE_FIELDS;
    return runSearch({
      address,
      lines: address.search["palm-beach"],
      zipSupported: false,
      zipMode: ctx.zip,
      unitFallback: ctx.unitFallback,
      async fetchRows({ unit }) {
        const features = await queryFeatures(ctx.http, PALM_BEACH_URL, {
          where: situsWhere("SITE_ADDR_STR", address.search["palm-beach"], unit),
          outFields,
          centroid: true,
          limit: ctx.maxResults,
        });
        return features.map((f) => toRecord(f, ctx)).filter((r): r is ParcelRecord => !!r);
      },
    });
  },

  async getByFolio(folio, ctx) {
    const outFields = ctx.include.owner ? [...BASE_FIELDS, ...OWNER_FIELDS] : BASE_FIELDS;
    const features = await queryFeatures(ctx.http, PALM_BEACH_URL, {
      where: `PARCEL_NUMBER = ${sqlString(cleanFolio(folio))}`,
      outFields,
      centroid: true,
      limit: 5,
    });
    for (const f of features) {
      const r = toRecord(f, ctx);
      if (r) return r;
    }
    return null;
  },
};
