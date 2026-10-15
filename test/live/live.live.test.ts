/**
 * Live contract tests against the real county services. NOT part of the default test run or PR CI:
 * run with `npm run test:live` (a scheduled workflow does this weekly). They assert shapes only and
 * never print or store returned data. Each failure here means a county renamed a service or a field.
 */
import { describe, expect, it } from "vitest";
import {
  BROWARD_ADDRESS_URL,
  BROWARD_TAXROLL_URL,
  MIAMI_DADE_URL,
  PALM_BEACH_URL,
  createClient,
  createHttp,
} from "../../src/index.js";

const http = createHttp({ timeoutMs: 30_000, retries: 2 });

// Fields each provider reads. Keep in sync with src/providers/*.ts and docs/endpoints.md.
const REQUIRED_FIELDS: [string, string, string[]][] = [
  ["Miami-Dade", MIAMI_DADE_URL, ["FOLIO", "LEGAL", "TRUE_SITE_ADDR", "TRUE_SITE_ZIP_CODE", "TRUE_OWNER1", "TRUE_OWNER2", "TRUE_OWNER3"]],
  ["Palm Beach", PALM_BEACH_URL, ["PARCEL_NUMBER", "SITE_ADDR_STR", "LEGAL1", "LEGAL2", "LEGAL3", "OWNER_NAME1", "OWNER_NAME2"]],
  ["Broward address points", BROWARD_ADDRESS_URL, ["FOLIONUMBER", "SITUSFULLADDRESS", "ZIPCODE", "LATITUDE", "LONGITUDE"]],
  [
    "Broward tax roll",
    BROWARD_TAXROLL_URL,
    ["FOLIO", "NAME_LINE_1", "NAME_LINE_2", "LEGAL_LINE_1", "LEGAL_LINE_14", "SITUS_STREET_NUMBER", "SITUS_STREET_DIRECTION", "SITUS_STREET_NAME", "SITUS_STREET_TYPE", "SITUS_STREET_POST_DIR", "SITUS_UNIT_NUMBER"],
  ],
];

describe("service schema contract", () => {
  for (const [name, url, fields] of REQUIRED_FIELDS) {
    it(`${name} still exposes the fields we read`, async () => {
      const meta = (await http(url, {})) as { fields?: { name: string }[] };
      const have = new Set((meta.fields ?? []).map((f) => f.name));
      expect([...fields].filter((f) => !have.has(f))).toEqual([]);
    });
  }
});

// Public government buildings, used only to prove the query path works end to end. Broward's address-point
// layer has no point for every building, so Broward samples an address from the service itself below.
const SAMPLES = [
  { county: "miami-dade" as const, address: "111 NW 1st St, Miami, FL 33128", folio: /^\d{13}$/ },
  { county: "palm-beach" as const, address: "301 N Olive Ave, West Palm Beach, FL 33401", folio: /^\d{17}$/ },
];

describe("end-to-end lookup", () => {
  const client = createClient({ timeoutMs: 30_000 });

  it("broward: sampled address point -> folio -> same folio", async () => {
    const body = (await http(`${BROWARD_ADDRESS_URL}/query`, {
      where: "UPPER(SITUSFULLADDRESS) LIKE '% S ANDREWS AVE' AND FOLIONUMBER IS NOT NULL AND UNITNUMBER IS NULL",
      outFields: "SITUSFULLADDRESS,CITYNAME,ZIPCODE",
      returnGeometry: false,
      resultRecordCount: 1,
    })) as { features: { attributes: Record<string, string> }[] };
    const a = body.features[0]?.attributes;
    expect(a, "no address point to sample").toBeDefined();
    const found = await client.lookupByAddress(`${a!["SITUSFULLADDRESS"]}, ${a!["CITYNAME"]}, FL ${a!["ZIPCODE"]}`, { county: "broward" });
    expect(found?.folio).toMatch(/^[0-9A-Z]{12}$/);
    expect((await client.lookupByFolio(found!.folio))?.folio).toBe(found!.folio);
  });

  for (const s of SAMPLES) {
    it(`${s.county}: address -> folio -> same folio`, async () => {
      const byAddress = await client.lookupByAddress(s.address, { county: s.county });
      expect(byAddress, "address should resolve").not.toBeNull();
      expect(byAddress!.folio).toMatch(s.folio);
      expect(byAddress!.county).toBe(s.county);
      const byFolio = await client.lookupByFolio(byAddress!.folio);
      expect(byFolio?.folio).toBe(byAddress!.folio);
    });
  }
});
