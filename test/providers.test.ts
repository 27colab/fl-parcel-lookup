import { describe, expect, it, vi } from "vitest";
import { createClient, formatFolio, InvalidFolioError, UnsupportedCountyError } from "../src/index.js";
import { fakeFetch, fixedNow, fixture, noSleep } from "./helpers.js";

const base = { sleep: noSleep, now: fixedNow, retries: 0 };

describe("Miami-Dade", () => {
  const fx = fixture("miami-dade");

  it("finds a parcel, dedupes polygon parts, drops longer street names, hides owners by default", async () => {
    const { fetch, calls } = fakeFetch({ PaParcelView: () => fx.street });
    const client = createClient({ ...base, fetch });
    const r = await client.lookupByAddress("100 Northwest 7th Street, Miami, FL 33125, USA");
    expect(r).toMatchObject({
      folio: "0100000000010",
      situs: "100 NW 7 ST",
      legal: "EXAMPLE PARK SUBD PB 1-1 LOT 5 BLK 2 LOT SIZE 5000 SQ FT",
      county: "miami-dade",
      coords: { lat: 25.78, lng: -80.2 },
      candidates: 1,
      ambiguous: false,
      source: { county: "miami-dade", retrievedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(r).not.toHaveProperty("owner");
    expect(calls).toHaveLength(1);
    const p = calls[0]!.params;
    expect(p.get("where")).toBe(
      "(UPPER(TRUE_SITE_ADDR) LIKE '100 NW 7 ST%' OR UPPER(TRUE_SITE_ADDR) LIKE '100 NW 7TH ST%') AND TRUE_SITE_ZIP_CODE LIKE '33125%'",
    );
    expect(p.get("outFields")).not.toMatch(/OWNER/);
    expect(p.get("returnCentroid")).toBe("true");
    expect(p.get("outSR")).toBe("4326");
  });

  it("requests and returns owners only when asked", async () => {
    const { fetch, calls } = fakeFetch({ PaParcelView: () => fx.street });
    const r = await createClient({ ...base, fetch }).lookupByAddress("100 NW 7th St, Miami, FL", { includeOwner: true });
    expect(r?.owner).toEqual(["EXAMPLE HOLDINGS LLC", "SAMPLE, JANE Q"]);
    expect(calls[0]!.params.get("outFields")).toMatch(/TRUE_OWNER1/);
  });

  it("can omit the legal description", async () => {
    const { fetch } = fakeFetch({ PaParcelView: () => fx.street });
    const r = await createClient({ ...base, fetch }).lookupByAddress("100 NW 7th St, Miami, FL", { includeLegal: false });
    expect(r?.legal).toBeNull();
  });

  it("retries without the ZIP when the ZIP filter finds nothing", async () => {
    const { fetch, calls } = fakeFetch({
      PaParcelView: (c) => (c.params.get("where")!.includes("ZIP_CODE") ? { features: [] } : fx.street),
    });
    const r = await createClient({ ...base, fetch }).lookupByAddress("100 NW 7th St, Miami, FL 99999");
    expect(r?.folio).toBe("0100000000010");
    expect(calls).toHaveLength(2);
  });

  it("zip: require does not retry", async () => {
    const { fetch, calls } = fakeFetch({ PaParcelView: () => ({ features: [] }) });
    const r = await createClient({ ...base, fetch }).lookupByAddress("100 NW 7th St, Miami, FL 99999", { zip: "require" });
    expect(r).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("zip: ignore never sends a ZIP clause", async () => {
    const { fetch, calls } = fakeFetch({ PaParcelView: () => fx.street });
    await createClient({ ...base, fetch }).lookupByAddress("100 NW 7th St, Miami, FL 33125", { zip: "ignore" });
    expect(calls[0]!.params.get("where")).not.toContain("ZIP");
  });

  it("matches a condo unit exactly and marks it", async () => {
    const { fetch, calls } = fakeFetch({ PaParcelView: () => fx.condo });
    const r = await createClient({ ...base, fetch }).lookupByAddress("200 NE 2nd Ave Apt 1504, Miami, FL");
    expect(r).toMatchObject({ folio: "0100000000022", unitMatched: true, ambiguous: false });
    expect(calls[0]!.params.get("where")).toContain("LIKE '200 NE 2 AVE %1504%'");
  });

  it("flags a building-level search as ambiguous", async () => {
    const { fetch } = fakeFetch({ PaParcelView: () => fx.condo });
    const c = createClient({ ...base, fetch });
    const r = await c.lookupByAddress("200 NE 2nd Ave, Miami, FL");
    expect(r).toMatchObject({ candidates: 2, ambiguous: true });
    expect((await c.searchByAddress("200 NE 2nd Ave, Miami, FL")).map((x) => x.folio)).toEqual([
      "0100000000021",
      "0100000000022",
    ]);
  });

  it("returns null for an unknown unit unless unitFallback is on", async () => {
    const { fetch } = fakeFetch({ PaParcelView: () => fx.condo });
    const c = createClient({ ...base, fetch });
    expect(await c.lookupByAddress("200 NE 2nd Ave Apt 9999, Miami, FL")).toBeNull();
    const r = await c.lookupByAddress("200 NE 2nd Ave Apt 9999, Miami, FL", { unitFallback: true });
    expect(r).toMatchObject({ unitMatched: false, ambiguous: true });
  });

  it("looks up by folio, dashes allowed", async () => {
    const { fetch, calls } = fakeFetch({ PaParcelView: () => fx.street });
    const r = await createClient({ ...base, fetch }).lookupByFolio("01-0000-000-0010");
    expect(r?.situs).toBe("100 NW 7 ST");
    expect(calls[0]!.params.get("where")).toBe("FOLIO = '0100000000010'");
  });

  it("returns null for an unknown folio", async () => {
    const { fetch } = fakeFetch({ PaParcelView: () => ({ features: [] }) });
    expect(await createClient({ ...base, fetch }).lookupByFolio("0100000000010")).toBeNull();
  });
});

describe("Palm Beach", () => {
  const fx = fixture("palm-beach");

  it("finds a parcel using the ordinal form PBC stores, and ignores ZIP (mailing ZIP only)", async () => {
    const { fetch, calls } = fakeFetch({ Parcels_and_Property_Details: () => fx.street });
    const r = await createClient({ ...base, fetch }).lookupByAddress("500 Southwest 8th Street, Boca Raton, Palm Beach County, FL 33432");
    expect(r).toMatchObject({
      folio: "00424700000000100",
      situs: "500 SW 8TH ST",
      legal: "EXAMPLE ESTATES PB 9 P 9 LT 10 BLK 3",
      county: "palm-beach",
      coords: { lat: 26.35, lng: -80.1 },
    });
    expect(calls).toHaveLength(1);
    const where = calls[0]!.params.get("where")!;
    expect(where).toBe("(UPPER(SITE_ADDR_STR) LIKE '500 SW 8TH ST%' OR UPPER(SITE_ADDR_STR) LIKE '500 SW 8 ST%')");
    expect(where).not.toMatch(/ZIP|CITY/);
  });

  it("collapses the padded legal text and matches a unit", async () => {
    const { fetch } = fakeFetch({ Parcels_and_Property_Details: () => fx.condo });
    const r = await createClient({ ...base, fetch }).lookupByAddress("600 N Sample Way #1601E, Jupiter, FL");
    expect(r).toMatchObject({ folio: "00434700000100160", legal: "SAMPLE TOWERS COND APT 1601E", unitMatched: true });
  });

  it("returns owners on opt-in", async () => {
    const { fetch } = fakeFetch({ Parcels_and_Property_Details: () => fx.street });
    const r = await createClient({ ...base, fetch }).lookupByAddress("500 SW 8th St, Boca Raton, FL", { includeOwner: true, county: "palm-beach" });
    expect(r?.owner).toEqual(["EXAMPLE FAMILY TRUST"]);
  });

  it("looks up by 17-digit folio", async () => {
    const { fetch, calls } = fakeFetch({ Parcels_and_Property_Details: () => fx.street });
    const r = await createClient({ ...base, fetch }).lookupByFolio("00-42-47-00-00-000-0100");
    expect(r?.folio).toBe("00424700000000100");
    expect(calls[0]!.params.get("where")).toBe("PARCEL_NUMBER = '00424700000000100'");
  });
});

describe("Broward", () => {
  const fx = fixture("broward");

  it("resolves address -> folio via address points, then legal via the tax roll", async () => {
    const { fetch, calls } = fakeFetch({
      GISAddressPoints: () => fx.points,
      BCPA_Parcel_TaxRoll: () => fx.taxRoll,
    });
    const r = await createClient({ ...base, fetch }).lookupByAddress("300 NW 58th Avenue, Sampleville, Broward County, FL 33313");
    expect(r).toMatchObject({
      folio: "000000AB0010",
      situs: "300 NW 58th AVE",
      legal: "SAMPLE ADDITION 1-2 B LOT 7 BLK 4",
      county: "broward",
      coords: { lat: 26.15, lng: -80.2 },
      candidates: 1,
    });
    expect(r).not.toHaveProperty("owner");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.params.get("where")).toBe(
      "(UPPER(SITUSFULLADDRESS) LIKE '300 NW 58TH AVE%' OR UPPER(SITUSFULLADDRESS) LIKE '300 NW 58 AVE%') AND ZIPCODE = '33313'",
    );
    expect(calls[1]!.params.get("where")).toBe("FOLIO IN ('000000AB0010')");
    expect(calls[1]!.params.get("outFields")).not.toMatch(/NAME_LINE/);
  });

  it("skips the tax roll when legal is not requested", async () => {
    const { fetch, calls } = fakeFetch({ GISAddressPoints: () => fx.points });
    const r = await createClient({ ...base, fetch }).lookupByAddress("300 NW 58th Avenue, Sampleville, Broward County, FL", { includeLegal: false });
    expect(r?.legal).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("adds owners from the tax roll on opt-in", async () => {
    const { fetch } = fakeFetch({ GISAddressPoints: () => fx.points, BCPA_Parcel_TaxRoll: () => fx.taxRoll });
    const r = await createClient({ ...base, fetch }).lookupByAddress("300 NW 58th Ave, Sampleville, Broward County, FL", { includeOwner: true });
    expect(r?.owner).toEqual(["EXAMPLE PROPERTIES LLC"]);
  });

  it("matches a unit", async () => {
    const { fetch } = fakeFetch({ GISAddressPoints: () => fx.unitPoints, BCPA_Parcel_TaxRoll: () => fx.taxRoll });
    const r = await createClient({ ...base, fetch }).lookupByAddress("400 N Sample Hwy Unit 103, Sampleville, Broward County, FL 33441");
    expect(r).toMatchObject({ folio: "000000AC0030", unitMatched: true, legal: "SAMPLE BEACH CLUB COND UNIT 103" });
  });

  it("folio lookup combines the address point and the tax roll", async () => {
    const { fetch, calls } = fakeFetch({ GISAddressPoints: () => fx.points, BCPA_Parcel_TaxRoll: () => fx.taxRoll });
    const r = await createClient({ ...base, fetch }).lookupByFolio("0000-00-AB-0010");
    expect(r).toMatchObject({ folio: "000000AB0010", situs: "300 NW 58th AVE", legal: "SAMPLE ADDITION 1-2 B LOT 7 BLK 4", county: "broward" });
    expect(calls).toHaveLength(2);
  });

  it("folio lookup falls back to tax roll situs when there is no address point", async () => {
    const { fetch } = fakeFetch({ GISAddressPoints: () => ({ features: [] }), BCPA_Parcel_TaxRoll: () => fx.taxRoll });
    const r = await createClient({ ...base, fetch }).lookupByFolio("000000AB0010");
    expect(r).toMatchObject({ situs: "300 NW 58 AVE", legal: "SAMPLE ADDITION 1-2 B LOT 7 BLK 4" });
    expect(r?.coords).toBeUndefined();
  });

  it("sends a User-Agent (Broward 403s without one)", async () => {
    const { fetch, calls } = fakeFetch({ GISAddressPoints: () => fx.points, BCPA_Parcel_TaxRoll: () => fx.taxRoll });
    await createClient({ ...base, fetch }).lookupByFolio("000000AB0010");
    expect(calls[0]!.headers["User-Agent"]).toMatch(/fl-parcel-lookup/);
  });
});

describe("routing and validation", () => {
  it("refuses an address with no detectable county", async () => {
    const c = createClient({ ...base, fetch: fakeFetch({}).fetch });
    await expect(c.lookupByAddress("100 Example St, Springfield, FL")).rejects.toBeInstanceOf(UnsupportedCountyError);
  });

  it("uses the county option when detection fails", async () => {
    const { fetch } = fakeFetch({ PaParcelView: () => ({ features: [] }) });
    expect(await createClient({ ...base, fetch }).lookupByAddress("100 Example St, Springfield, FL", { county: "miami-dade" })).toBeNull();
  });

  it("detects the county from the folio shape", async () => {
    const { fetch, calls } = fakeFetch({ PaParcelView: () => ({ features: [] }), Parcels_and_Property: () => ({ features: [] }) });
    const c = createClient({ ...base, fetch });
    await c.lookupByFolio("0100000000010");
    await c.lookupByFolio("00424700000000100");
    expect(calls.map((x) => new URL(x.endpoint).host)).toEqual(["services.arcgis.com", "services1.arcgis.com"]);
  });

  it("rejects malformed folios", async () => {
    const c = createClient({ ...base, fetch: fakeFetch({}).fetch });
    await expect(c.lookupByFolio("12345")).rejects.toBeInstanceOf(InvalidFolioError);
    await expect(c.lookupByFolio("12345", { county: "miami-dade" })).rejects.toBeInstanceOf(InvalidFolioError);
  });

  it("escapes quotes in a street name", async () => {
    const { fetch, calls } = fakeFetch({ PaParcelView: () => ({ features: [] }) });
    await createClient({ ...base, fetch }).lookupByAddress("100 O'Brien St, Miami, FL");
    expect(calls[0]!.params.get("where")).toContain("'100 O''BRIEN ST%'");
  });

  it("accepts a custom provider", async () => {
    const stub = {
      id: "broward" as const,
      name: "stub",
      isValidFolio: () => true,
      searchByAddress: async () => [],
      getByFolio: async () => null,
    };
    expect(await createClient({ ...base, providers: [stub] }).lookupByAddress("100 Example St, Fort Lauderdale, FL")).toBeNull();
  });

  it("formats folios", () => {
    expect(formatFolio("miami-dade", "0141020890001")).toBe("01-4102-089-0001");
    expect(formatFolio("palm-beach", "50434303040000130")).toBe("50-43-43-03-04-000-0130");
    expect(formatFolio("broward", "504234010010")).toBe("5042-34-01-0010");
  });
});

describe("privacy", () => {
  it("never writes to the console and never leaks owner names into errors", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const fx = fixture("miami-dade");
    const ok = fakeFetch({ PaParcelView: () => fx.street });
    await createClient({ ...base, fetch: ok.fetch }).lookupByAddress("100 NW 7th St, Miami, FL", { includeOwner: true });
    const bad = fakeFetch({ PaParcelView: () => ({ error: { code: 400, message: "Unable to complete operation." } }) });
    const err = await createClient({ ...base, fetch: bad.fetch }).lookupByAddress("100 NW 7th St, Miami, FL").catch((e) => e);
    expect(String(err.message)).not.toMatch(/EXAMPLE|SAMPLE/);
    expect(err.message).not.toContain("where=");
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});
