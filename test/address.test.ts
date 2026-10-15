import { describe, expect, it } from "vitest";
import { InvalidAddressError, UnsupportedCountyError, normalizeAddress, type PlaceComponent } from "../src/index.js";

interface Case {
  name: string;
  input: string;
  /** Miami-Dade primary street line (ordinals stripped). */
  md: string;
  /** Palm Beach / Broward primary line when it differs (ordinals kept). */
  ord?: string;
  unit?: string;
  zip?: string;
  zip4?: string;
  city?: string;
  county?: "miami-dade" | "broward" | "palm-beach";
}

const cases: Case[] = [
  // --- suffix abbreviation
  { name: "street", input: "100 Example Street, Miami, FL 33130", md: "100 EXAMPLE ST", zip: "33130", city: "Miami" },
  { name: "avenue", input: "100 Example Avenue, Miami, FL", md: "100 EXAMPLE AVE" },
  { name: "boulevard", input: "100 Example Boulevard, Miami, FL", md: "100 EXAMPLE BLVD" },
  { name: "drive", input: "100 Example Drive, Miami, FL", md: "100 EXAMPLE DR" },
  { name: "court", input: "100 Example Court, Miami, FL", md: "100 EXAMPLE CT" },
  { name: "terrace", input: "100 Example Terrace, Miami, FL", md: "100 EXAMPLE TER" },
  { name: "place", input: "100 Example Place, Miami, FL", md: "100 EXAMPLE PL" },
  { name: "road", input: "100 Example Road, Miami, FL", md: "100 EXAMPLE RD" },
  { name: "lane", input: "100 Example Lane, Miami, FL", md: "100 EXAMPLE LN" },
  { name: "parkway", input: "100 Example Parkway, Miami, FL", md: "100 EXAMPLE PKWY" },
  { name: "circle", input: "100 Example Circle, Miami, FL", md: "100 EXAMPLE CIR" },
  { name: "highway", input: "100 Example Highway, Miami, FL", md: "100 EXAMPLE HWY" },
  { name: "trail", input: "100 Example Trail, Miami, FL", md: "100 EXAMPLE TRL" },
  { name: "causeway", input: "100 Example Causeway, Miami, FL", md: "100 EXAMPLE CSWY" },
  { name: "way", input: "100 Example Way, Miami, FL", md: "100 EXAMPLE WAY" },
  { name: "already abbreviated", input: "100 Example St, Miami, FL", md: "100 EXAMPLE ST" },
  { name: "abbreviated with period", input: "100 Example St., Miami, FL", md: "100 EXAMPLE ST" },
  { name: "lower case", input: "100 example street, miami, fl", md: "100 EXAMPLE ST" },
  { name: "heights", input: "100 Example Heights, Miami, FL", md: "100 EXAMPLE HTS" },
  { name: "key", input: "100 Example Key, Miami, FL", md: "100 EXAMPLE KY" },
  { name: "no type", input: "100 Example, Miami, FL", md: "100 EXAMPLE" },
  { name: "multi-word name", input: "100 Royal Palm Boulevard, Miami, FL", md: "100 ROYAL PALM BLVD" },
  // --- directionals
  { name: "NW prefix", input: "100 NW Example St, Miami, FL", md: "100 NW EXAMPLE ST" },
  { name: "Northwest spelled", input: "100 Northwest Example Street, Miami, FL", md: "100 NW EXAMPLE ST" },
  { name: "N.W. dotted", input: "100 N.W. Example St, Miami, FL", md: "100 NW EXAMPLE ST" },
  { name: "North prefix", input: "100 North Example Avenue, Miami, FL", md: "100 N EXAMPLE AVE" },
  { name: "South prefix", input: "100 South Example Avenue, Miami, FL", md: "100 S EXAMPLE AVE" },
  { name: "East prefix", input: "100 East Example Drive, Miami, FL", md: "100 E EXAMPLE DR" },
  { name: "West prefix", input: "100 West Example Drive, Miami, FL", md: "100 W EXAMPLE DR" },
  { name: "Southeast spelled", input: "100 Southeast Example Ct, Miami, FL", md: "100 SE EXAMPLE CT" },
  { name: "Southwest spelled", input: "100 Southwest Example Ct, Miami, FL", md: "100 SW EXAMPLE CT" },
  { name: "Northeast spelled", input: "100 Northeast Example Ct, Miami, FL", md: "100 NE EXAMPLE CT" },
  { name: "post-directional", input: "100 Example Street NW, Miami, FL", md: "100 EXAMPLE ST NW" },
  { name: "post-directional spelled", input: "100 Example Street Southwest, Miami, FL", md: "100 EXAMPLE ST SW" },
  { name: "pre and post", input: "100 N Example St SE, Miami, FL", md: "100 N EXAMPLE ST SE" },
  { name: "lone direction is the name (West Ave)", input: "100 West Avenue, Miami Beach, FL", md: "100 WEST AVE" },
  { name: "lone direction is the name (East Dr)", input: "100 East Drive, Miami, FL", md: "100 EAST DR" },
  { name: "direction as only token after number", input: "100 North, Miami, FL", md: "100 NORTH" },
  // --- ordinals
  { name: "ordinal 7th", input: "100 NW 7th Street, Miami, FL", md: "100 NW 7 ST", ord: "100 NW 7TH ST" },
  { name: "ordinal 1st", input: "100 NE 1st Avenue, Miami, FL", md: "100 NE 1 AVE", ord: "100 NE 1ST AVE" },
  { name: "ordinal 2nd", input: "100 SW 2nd Court, Miami, FL", md: "100 SW 2 CT", ord: "100 SW 2ND CT" },
  { name: "ordinal 3rd", input: "100 SE 3rd Terrace, Miami, FL", md: "100 SE 3 TER", ord: "100 SE 3RD TER" },
  { name: "ordinal 11th", input: "100 NW 11th Street, Miami, FL", md: "100 NW 11 ST", ord: "100 NW 11TH ST" },
  { name: "ordinal 22nd", input: "100 NW 22nd Avenue, Miami, FL", md: "100 NW 22 AVE", ord: "100 NW 22ND AVE" },
  { name: "ordinal 113th", input: "100 SW 113th Place, Miami, FL", md: "100 SW 113 PL", ord: "100 SW 113TH PL" },
  { name: "ordinal upper case", input: "100 NW 7TH ST, MIAMI, FL", md: "100 NW 7 ST", ord: "100 NW 7TH ST" },
  { name: "no ordinal numeric", input: "100 NW 7 St, Miami, FL", md: "100 NW 7 ST" },
  { name: "ordinal with post-dir", input: "100 7th Street NW, Miami, FL", md: "100 7 ST NW", ord: "100 7TH ST NW" },
  { name: "ordinal no direction", input: "100 12th Avenue, Miami, FL", md: "100 12 AVE", ord: "100 12TH AVE" },
  { name: "name containing digits only", input: "100 NW 107 Avenue, Miami, FL", md: "100 NW 107 AVE" },
  // --- units
  { name: "Apt", input: "100 Example St Apt 4B, Miami, FL 33130", md: "100 EXAMPLE ST", unit: "4B" },
  { name: "Apt dot", input: "100 Example St Apt. 4B, Miami, FL", md: "100 EXAMPLE ST", unit: "4B" },
  { name: "Unit", input: "100 Example St Unit 12, Miami, FL", md: "100 EXAMPLE ST", unit: "12" },
  { name: "hash", input: "100 Example St #305, Miami, FL", md: "100 EXAMPLE ST", unit: "305" },
  { name: "hash with space", input: "100 Example St # 305, Miami, FL", md: "100 EXAMPLE ST", unit: "305" },
  { name: "Suite", input: "100 Example St Suite 200, Miami, FL", md: "100 EXAMPLE ST", unit: "200" },
  { name: "Ste", input: "100 Example St Ste 200A, Miami, FL", md: "100 EXAMPLE ST", unit: "200A" },
  { name: "unit in own segment", input: "100 Example St, Apt 9, Miami, FL 33130", md: "100 EXAMPLE ST", unit: "9", city: "Miami" },
  { name: "unit with hyphen", input: "100 Example St Unit A-12, Miami, FL", md: "100 EXAMPLE ST", unit: "A-12" },
  { name: "unit on ordinal street", input: "100 NE 2nd Ave Apt 1503, Miami, FL", md: "100 NE 2 AVE", ord: "100 NE 2ND AVE", unit: "1503" },
  { name: "Apartment spelled", input: "100 Example Ave Apartment 7, Miami, FL", md: "100 EXAMPLE AVE", unit: "7" },
  { name: "no unit", input: "100 Example St, Miami, FL", md: "100 EXAMPLE ST" },
  // --- ZIP tails
  { name: "zip5", input: "100 Example St, Miami, FL 33130", md: "100 EXAMPLE ST", zip: "33130" },
  { name: "zip+4", input: "100 Example St, Miami, FL 33130-1234", md: "100 EXAMPLE ST", zip: "33130", zip4: "1234" },
  { name: "with USA", input: "100 Example St, Miami, FL 33130, USA", md: "100 EXAMPLE ST", zip: "33130", city: "Miami" },
  { name: "with United States", input: "100 Example St, Miami, FL 33130, United States", md: "100 EXAMPLE ST", zip: "33130" },
  { name: "state and zip separate", input: "100 Example St, Miami, 33130, FL", md: "100 EXAMPLE ST" },
  { name: "Florida spelled", input: "100 Example St, Miami, Florida 33130", md: "100 EXAMPLE ST", zip: "33130" },
  // --- county in text
  { name: "county in text MD", input: "100 Example St, Miami, Miami-Dade County, FL 33130", md: "100 EXAMPLE ST", county: "miami-dade" },
  { name: "county in text BR", input: "100 Example St, Hollywood, Broward County, FL 33020", md: "100 EXAMPLE ST", county: "broward" },
  { name: "county in text PB", input: "100 Example St, Jupiter, Palm Beach County, FL 33458", md: "100 EXAMPLE ST", county: "palm-beach" },
  // --- county from city heuristic
  { name: "city MD", input: "100 Example St, Hialeah, FL 33010", md: "100 EXAMPLE ST", county: "miami-dade", city: "Hialeah" },
  { name: "city BR", input: "100 Example St, Fort Lauderdale, FL 33301", md: "100 EXAMPLE ST", county: "broward" },
  { name: "city PB", input: "100 Example St, Boca Raton, FL 33432", md: "100 EXAMPLE ST", county: "palm-beach" },
  { name: "city Hollywood is Broward", input: "100 Example St, Hollywood, FL", md: "100 EXAMPLE ST", county: "broward" },
  { name: "city West Palm Beach", input: "100 Example St, West Palm Beach, FL", md: "100 EXAMPLE ST", county: "palm-beach" },
  // --- spelled-out ordinals, road designations, fractions, comma-less text
  { name: "spelled ordinal Seventh", input: "100 NW Seventh Street, Miami, FL", md: "100 NW 7 ST", ord: "100 NW 7TH ST" },
  { name: "spelled ordinal First", input: "100 NE First Avenue, Miami, FL", md: "100 NE 1 AVE", ord: "100 NE 1ST AVE" },
  { name: "spelled ordinal Twentieth", input: "100 SW Twentieth Court, Miami, FL", md: "100 SW 20 CT", ord: "100 SW 20TH CT" },
  { name: "State Road", input: "100 State Road 7, Miami, FL", md: "100 SR 7" },
  { name: "SR with hyphen", input: "100 SR-84, Fort Lauderdale, FL", md: "100 SR 84" },
  { name: "US Highway", input: "100 US Highway 1, Miami, FL", md: "100 US 1" },
  { name: "County Road", input: "100 County Road 702, Belle Glade, FL", md: "100 CR 702" },
  { name: "directional + road designation", input: "100 N State Road 7, Miami, FL", md: "100 N SR 7" },
  { name: "fractional number", input: "100 1/2 Example St, Miami, FL", md: "100 1/2 EXAMPLE ST" },
  { name: "comma-less with city, state, zip", input: "100 NW 7th St Miami FL 33125", md: "100 NW 7 ST", ord: "100 NW 7TH ST", zip: "33125", city: "Miami", county: "miami-dade" },
  { name: "comma-less multi-word city", input: "100 Collins Ave Miami Beach FL 33139", md: "100 COLLINS AVE", city: "Miami Beach", county: "miami-dade" },
  { name: "comma-less, street named like a city", input: "100 Miami Avenue Miami FL 33130", md: "100 MIAMI AVE", city: "Miami" },
  { name: "comma-less with unit", input: "100 Example St Apt 4B West Palm Beach FL 33401", md: "100 EXAMPLE ST", unit: "4B", county: "palm-beach" },
  // --- whitespace / punctuation
  { name: "extra spaces", input: "  100   Example   Street ,  Miami , FL  33130 ", md: "100 EXAMPLE ST", zip: "33130" },
  { name: "apostrophe", input: "100 O'Brien Street, Miami, FL", md: "100 O'BRIEN ST" },
  { name: "ampersand", input: "100 Smith & Jones Road, Miami, FL", md: "100 SMITH & JONES RD" },
  { name: "street number letter", input: "100A Example St, Miami, FL", md: "100A EXAMPLE ST" },
  { name: "long number", input: "12345 Example St, Miami, FL", md: "12345 EXAMPLE ST" },
  { name: "name is a type word (Park Ave)", input: "100 Park Avenue, Miami, FL", md: "100 PARK AVE" },
  { name: "name ends in key-type word", input: "100 Coral Way, Miami, FL", md: "100 CORAL WAY" },
  { name: "avenue abbreviation av", input: "100 Example Av, Miami, FL", md: "100 EXAMPLE AVE" },
];

describe("normalizeAddress: string table", () => {
  it("has at least 90 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(90);
  });

  for (const c of cases) {
    it(c.name, () => {
      const n = normalizeAddress(c.input);
      const ord = c.ord ?? c.md;
      expect(n.search["miami-dade"][0]).toBe(c.md);
      expect(n.search["palm-beach"][0]).toBe(ord);
      expect(n.search["broward"][0]).toBe(ord);
      // Both spellings are always offered, so a county that stores the other form still matches.
      expect(n.search["miami-dade"]).toContain(ord);
      expect(n.search["palm-beach"]).toContain(c.md);
      expect(n.unit).toBe(c.unit);
      if (c.zip) expect(n.zip).toBe(c.zip);
      if (c.zip4) expect(n.zip4).toBe(c.zip4);
      if (c.city) expect(n.city).toBe(c.city);
      if (c.county) expect(n.county).toBe(c.county);
    });
  }
});

const comp = (long: string, types: string[], short = long): PlaceComponent => ({
  long_name: long,
  short_name: short,
  types,
});

describe("normalizeAddress: Google address_components", () => {
  const place = (extra: PlaceComponent[] = []) => ({
    address_components: [
      comp("100", ["street_number"]),
      comp("Northwest 7th Street", ["route"], "NW 7th St"),
      comp("Miami", ["locality", "political"]),
      comp("Miami-Dade County", ["administrative_area_level_2", "political"]),
      comp("Florida", ["administrative_area_level_1", "political"], "FL"),
      comp("United States", ["country", "political"], "US"),
      comp("33125", ["postal_code"]),
      comp("1234", ["postal_code_suffix"]),
      ...extra,
    ],
  });

  it("reads number, route, city, county, ZIP and ZIP+4", () => {
    const n = normalizeAddress(place());
    expect(n).toMatchObject({
      streetNumber: "100",
      preDirection: "NW",
      streetName: "7TH",
      streetType: "ST",
      city: "Miami",
      state: "FL",
      zip: "33125",
      zip4: "1234",
      county: "miami-dade",
    });
    expect(n.search["miami-dade"]).toEqual(["100 NW 7 ST", "100 NW 7TH ST"]);
    expect(n.search["palm-beach"]).toEqual(["100 NW 7TH ST", "100 NW 7 ST"]);
  });

  it("reads subpremise as the unit, with or without a keyword", () => {
    expect(normalizeAddress(place([comp("4B", ["subpremise"])])).unit).toBe("4B");
    expect(normalizeAddress(place([comp("Apt 4B", ["subpremise"])])).unit).toBe("4B");
    expect(normalizeAddress(place([comp("#12", ["subpremise"])])).unit).toBe("12");
  });

  it("falls back to postal_town / sublocality when there is no locality", () => {
    const p = place();
    p.address_components = p.address_components.filter((c) => !c.types.includes("locality"));
    p.address_components.push(comp("Kendall", ["sublocality_level_1"]));
    expect(normalizeAddress(p).city).toBe("Kendall");
  });

  it("accepts the Places API (New) shape", () => {
    const n = normalizeAddress({
      addressComponents: [
        { longText: "100", shortText: "100", types: ["street_number"] },
        { longText: "Southwest 8th Street", shortText: "SW 8th St", types: ["route"] },
        { longText: "Broward County", shortText: "Broward County", types: ["administrative_area_level_2"] },
        { longText: "Florida", shortText: "FL", types: ["administrative_area_level_1"] },
      ],
    });
    expect(n.county).toBe("broward");
    expect(n.search.broward[0]).toBe("100 SW 8TH ST");
  });

  it("falls back to formatted_address when components lack a street", () => {
    const n = normalizeAddress({
      address_components: [comp("Miami", ["locality"])],
      formatted_address: "100 NE 2nd Ave, Miami, FL 33132, USA",
    });
    expect(n.search["miami-dade"][0]).toBe("100 NE 2 AVE");
    expect(n.zip).toBe("33132");
  });

  it("offers every road-designation spelling", () => {
    expect(normalizeAddress("100 State Road 7, Miami, FL").search["miami-dade"]).toEqual(["100 SR 7", "100 STATE ROAD 7", "100 STATE RD 7"]);
  });

  it("keeps the spelled-out form as a last-resort variant", () => {
    expect(normalizeAddress("100 NW Seventh St, Miami, FL").search["miami-dade"]).toEqual(["100 NW 7 ST", "100 NW 7TH ST", "100 NW SEVENTH ST"]);
  });

  it("an explicit county option wins", () => {
    expect(normalizeAddress(place(), { county: "broward" }).county).toBe("broward");
  });

  it("rejects counties we do not serve", () => {
    const p = place();
    p.address_components = p.address_components.map((c) =>
      c.types.includes("administrative_area_level_2") ? comp("Monroe County", c.types) : c,
    );
    expect(() => normalizeAddress(p)).toThrow(UnsupportedCountyError);
  });

  it("rejects non-Florida states", () => {
    const p = place();
    p.address_components = p.address_components.map((c) =>
      c.types.includes("administrative_area_level_1") ? comp("Georgia", c.types, "GA") : c,
    );
    expect(() => normalizeAddress(p)).toThrow(UnsupportedCountyError);
  });
});

describe("normalizeAddress: invalid input", () => {
  for (const bad of ["", "   ", "Miami, FL", "Example Street, Miami, FL", "no number here"]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(() => normalizeAddress(bad)).toThrow(InvalidAddressError);
    });
  }
  it("rejects a place with no components and no text", () => {
    expect(() => normalizeAddress({})).toThrow(InvalidAddressError);
  });
  it("never lets LIKE wildcards or SQL quotes through", () => {
    const n = normalizeAddress("100 50%_Example St, Miami, FL");
    for (const line of n.search["miami-dade"]) expect(line).not.toMatch(/[%_]/);
  });
});
