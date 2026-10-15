import { queryFeatures, sqlString, str, type Feature } from "../arcgis.js";
import { cleanFolio } from "../county.js";
import { runSearch, situsWhere } from "../match.js";
import type { CountyProvider, NormalizedAddress, ParcelRecord, ProviderContext } from "../types.js";

/** Miami-Dade County GIS Open Data, "Property Boundary View" (property appraiser data joined to parcel polygons). */
export const MIAMI_DADE_URL =
  "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/PaParcelView_gdb/FeatureServer/0";

const BASE_FIELDS = ["FOLIO", "LEGAL", "TRUE_SITE_ADDR", "TRUE_SITE_CITY", "TRUE_SITE_ZIP_CODE"];
const OWNER_FIELDS = ["TRUE_OWNER1", "TRUE_OWNER2", "TRUE_OWNER3"];

function toRecord(f: Feature, ctx: ProviderContext): ParcelRecord | undefined {
  const a = f.attributes;
  const folio = str(a["FOLIO"]);
  const situs = str(a["TRUE_SITE_ADDR"]);
  if (!folio || !situs) return undefined;
  const rec: ParcelRecord = {
    folio: cleanFolio(folio),
    situs,
    legal: ctx.include.legal ? (str(a["LEGAL"]) ?? null) : null,
    county: "miami-dade",
    source: {
      county: "miami-dade",
      dataset: "Miami-Dade County GIS Open Data: Property Boundary View",
      url: MIAMI_DADE_URL,
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

export const miamiDadeProvider: CountyProvider = {
  id: "miami-dade",
  name: "Miami-Dade County",

  isValidFolio: (folio) => /^\d{13}$/.test(cleanFolio(folio)),

  searchByAddress(address: NormalizedAddress, ctx) {
    const outFields = ctx.include.owner ? [...BASE_FIELDS, ...OWNER_FIELDS] : BASE_FIELDS;
    return runSearch({
      address,
      lines: address.search["miami-dade"],
      zipSupported: true,
      zipMode: ctx.zip,
      unitFallback: ctx.unitFallback,
      async fetchRows({ unit, zip }) {
        const extra = zip ? `TRUE_SITE_ZIP_CODE LIKE ${sqlString(`${zip}%`)}` : undefined;
        const features = await queryFeatures(ctx.http, MIAMI_DADE_URL, {
          where: situsWhere("TRUE_SITE_ADDR", address.search["miami-dade"], unit, extra),
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
    const features = await queryFeatures(ctx.http, MIAMI_DADE_URL, {
      where: `FOLIO = ${sqlString(cleanFolio(folio))}`,
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

