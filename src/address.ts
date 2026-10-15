import { componentValue, countyFromCity, countyFromName, detectCounty, placeComponents } from "./county.js";
import { InvalidAddressError, UnsupportedCountyError } from "./errors.js";
import type { AddressInput, CountyId, NormalizedAddress, PlaceLike } from "./types.js";

const DIRECTIONS: Record<string, string> = {
  N: "N", NORTH: "N", S: "S", SOUTH: "S", E: "E", EAST: "E", W: "W", WEST: "W",
  NE: "NE", NORTHEAST: "NE", NW: "NW", NORTHWEST: "NW", SE: "SE", SOUTHEAST: "SE", SW: "SW", SOUTHWEST: "SW",
};

// Street types -> USPS abbreviation (Publication 28, Appendix C1, the subset that appears in South Florida).
const STREET_TYPES: Record<string, string> = {
  ALLEY: "ALY", ALY: "ALY", AVENUE: "AVE", AVE: "AVE", AV: "AVE", BEACH: "BCH", BCH: "BCH",
  BOULEVARD: "BLVD", BLVD: "BLVD", BOUL: "BLVD", BRIDGE: "BRG", BRG: "BRG", BYPASS: "BYP", BYP: "BYP",
  CAUSEWAY: "CSWY", CSWY: "CSWY", CENTER: "CTR", CENTRE: "CTR", CTR: "CTR", CIRCLE: "CIR", CIR: "CIR",
  COURT: "CT", CT: "CT", COVE: "CV", CV: "CV", CREEK: "CRK", CRK: "CRK", CROSSING: "XING", XING: "XING",
  DRIVE: "DR", DR: "DR", EXPRESSWAY: "EXPY", EXPY: "EXPY", EXTENSION: "EXT", EXT: "EXT",
  FIELDS: "FLDS", FLDS: "FLDS", FREEWAY: "FWY", FWY: "FWY", GARDEN: "GDN", GDN: "GDN", GARDENS: "GDNS",
  GDNS: "GDNS", GLEN: "GLN", GLN: "GLN", GROVE: "GRV", GRV: "GRV", HARBOR: "HBR", HBR: "HBR",
  HEIGHTS: "HTS", HTS: "HTS", HIGHWAY: "HWY", HWY: "HWY", HILL: "HL", HL: "HL", HILLS: "HLS", HLS: "HLS",
  ISLAND: "IS", ISLE: "ISLE", JUNCTION: "JCT", JCT: "JCT", KEY: "KY", KY: "KY", LAKE: "LK", LK: "LK",
  LANE: "LN", LN: "LN", LOOP: "LOOP", MANOR: "MNR", MNR: "MNR", MEADOW: "MDW", MDW: "MDW",
  MEADOWS: "MDWS", MDWS: "MDWS", PARK: "PARK", PARKWAY: "PKWY", PKWY: "PKWY", PASS: "PASS", PATH: "PATH",
  PIKE: "PIKE", PLACE: "PL", PL: "PL", PLAZA: "PLZ", PLZ: "PLZ", POINT: "PT", POINTE: "PT", PT: "PT",
  PORT: "PRT", PRT: "PRT", RANCH: "RNCH", RNCH: "RNCH", RIDGE: "RDG", RDG: "RDG", ROAD: "RD", RD: "RD",
  ROW: "ROW", RUN: "RUN", SHORE: "SHR", SHR: "SHR", SHORES: "SHRS", SHRS: "SHRS", SPRINGS: "SPGS",
  SPGS: "SPGS", SQUARE: "SQ", SQ: "SQ", STREET: "ST", STR: "ST", ST: "ST", TERRACE: "TER", TER: "TER",
  TERR: "TER", TRACE: "TRCE", TRCE: "TRCE", TRAIL: "TRL", TRL: "TRL", TURNPIKE: "TPKE", TPKE: "TPKE",
  VIEW: "VW", VW: "VW", VILLAGE: "VLG", VLG: "VLG", VISTA: "VIS", VIS: "VIS", WALK: "WALK", WAY: "WAY",
};

const UNIT_WORDS =
  "APT|APARTMENT|UNIT|STE|SUITE|BLDG|BUILDING|LOT|SPC|SPACE|RM|ROOM|PH|PENTHOUSE";
const TRAILING_UNIT = new RegExp(`\\s+(?:(?:${UNIT_WORDS})\\.?\\s*#?\\s*|#\\s*)([A-Z0-9][A-Z0-9-]*(?:\\s[A-Z0-9])?)\\s*$`, "i");
const LEADING_UNIT = new RegExp(`^(?:(?:${UNIT_WORDS})\\.?\\s*#?\\s*|#\\s*)?([A-Z0-9][A-Z0-9 -]*)$`, "i");
const ORDINAL = /^(\d+)(?:ST|ND|RD|TH)$/;

const SPELLED_ORDINALS: Record<string, string> = {
  FIRST: "1ST", SECOND: "2ND", THIRD: "3RD", FOURTH: "4TH", FIFTH: "5TH", SIXTH: "6TH", SEVENTH: "7TH",
  EIGHTH: "8TH", NINTH: "9TH", TENTH: "10TH", ELEVENTH: "11TH", TWELFTH: "12TH", THIRTEENTH: "13TH",
  FOURTEENTH: "14TH", FIFTEENTH: "15TH", SIXTEENTH: "16TH", SEVENTEENTH: "17TH", EIGHTEENTH: "18TH",
  NINETEENTH: "19TH", TWENTIETH: "20TH", THIRTIETH: "30TH", FORTIETH: "40TH", FIFTIETH: "50TH",
};

// "State Road 7" / "SR-7" / "FL 7", "US Highway 1" / "US-1", "County Road 702" / "CR 702": the counties
// are not consistent about which form they store, so the preferred form is followed by the others.
const DESIGNATIONS: [RegExp, string, string[]][] = [
  [/^(?:STATE ROAD|STATE RD|STATE HWY|STATE HIGHWAY|SR|FL|FLORIDA)[ -]?(\d+[A-Z]?)$/, "SR", ["SR", "STATE ROAD", "STATE RD"]],
  [/^(?:US HIGHWAY|US HWY|US ROUTE|US|U S|UNITED STATES HIGHWAY)[ -]?(\d+[A-Z]?)$/, "US", ["US", "US HWY", "US HIGHWAY"]],
  [/^(?:COUNTY ROAD|COUNTY RD|CR)[ -]?(\d+[A-Z]?)$/, "CR", ["CR", "COUNTY ROAD", "COUNTY RD"]],
];

function designationNames(name: string): string[] | undefined {
  for (const [re, , forms] of DESIGNATIONS) {
    const m = re.exec(name);
    if (m) return forms.map((f) => `${f} ${m[1]}`);
  }
  return undefined;
}

export function cleanUnit(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = LEADING_UNIT.exec(raw.trim().toUpperCase().replace(/^#\s*/, ""));
  const v = (m?.[1] ?? raw).toUpperCase().replace(/[^A-Z0-9-]/g, "").replace(/^-+|-+$/g, "");
  return v || undefined;
}

export function stripOrdinals(s: string): string {
  return s.replace(/\b(\d+)(?:ST|ND|RD|TH)\b/gi, "$1");
}

interface StreetParts {
  pre?: string;
  /** Preferred name first; alternates (spelled-out ordinal, road designations) after it. */
  names: string[];
  type?: string;
  post?: string;
}

function parseRoute(route: string): StreetParts {
  const tokens = route
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/[^A-Z0-9 '&/-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) throw new InvalidAddressError("Street name is empty");

  let pre: string | undefined;
  let post: string | undefined;
  let type: string | undefined;
  let start = 0;
  let end = tokens.length;

  // "West Ave" / "East Dr": a lone direction followed by a type is the street name, not a prefix.
  const first = tokens[0]!;
  if (end - start >= 2 && DIRECTIONS[first] && !(end - start === 2 && STREET_TYPES[tokens[1]!])) {
    pre = DIRECTIONS[first];
    start = 1;
  }
  const last = tokens[end - 1]!;
  if (end - start >= 3 && DIRECTIONS[last] && STREET_TYPES[tokens[end - 2]!]) {
    post = DIRECTIONS[last];
    end -= 1;
  }
  const tail = tokens[end - 1]!;
  if (end - start >= 2 && STREET_TYPES[tail]) {
    type = STREET_TYPES[tail];
    end -= 1;
  }
  const original = tokens.slice(start, end).join(" ");
  const converted = original.split(" ").map((t) => SPELLED_ORDINALS[t] ?? t).join(" ");
  const names = designationNames(original) ?? [converted];
  if (converted !== original) names.push(original);
  const out: StreetParts = { names };
  if (pre) out.pre = pre;
  if (type) out.type = type;
  if (post) out.post = post;
  return out;
}

function nameVariants(name: string, preferStripped: boolean): string[] {
  const stripped = name
    .split(" ")
    .map((t) => {
      const m = ORDINAL.exec(t);
      return m ? m[1]! : t;
    })
    .join(" ");
  if (stripped === name) return [name];
  return preferStripped ? [stripped, name] : [name, stripped];
}

function buildSearch(a: {
  streetNumber: string;
  pre?: string | undefined;
  names: string[];
  type?: string | undefined;
  post?: string | undefined;
}): Record<CountyId, string[]> {
  const line = (n: string) => [a.streetNumber, a.pre, n, a.type, a.post].filter(Boolean).join(" ");
  const all = (preferStripped: boolean) => [
    ...new Set(a.names.flatMap((n) => nameVariants(n, preferStripped)).map(line)),
  ];
  const stripFirst = all(true);
  const ordFirst = all(false);
  // Miami-Dade stores "NW 7 ST"; Palm Beach "SW 8TH ST"; Broward mixes both ("NW 58th AVE", "NW 40 TER").
  return { "miami-dade": stripFirst, "palm-beach": ordFirst, broward: ordFirst };
}

interface Raw {
  streetNumber?: string;
  route?: string;
  unit?: string;
  city?: string;
  state?: string;
  zip?: string;
  zip4?: string;
  countyName?: string;
}

function fromComponents(place: PlaceLike): Raw | undefined {
  const comps = placeComponents(place);
  if (!comps || comps.length === 0) return undefined;
  const raw: Raw = {};
  const set = <K extends keyof Raw>(k: K, v: Raw[K]) => {
    if (v !== undefined) raw[k] = v;
  };
  set("streetNumber", componentValue(comps, "street_number"));
  set("route", componentValue(comps, "route"));
  set("unit", componentValue(comps, "subpremise"));
  set(
    "city",
    componentValue(comps, "locality") ??
      componentValue(comps, "postal_town") ??
      componentValue(comps, "sublocality_level_1") ??
      componentValue(comps, "neighborhood"),
  );
  set("state", componentValue(comps, "administrative_area_level_1", "short"));
  set("zip", componentValue(comps, "postal_code"));
  set("zip4", componentValue(comps, "postal_code_suffix"));
  set("countyName", componentValue(comps, "administrative_area_level_2"));
  return raw;
}

function fromString(text: string): Raw {
  let segs = text.split(",").map((s) => s.trim()).filter(Boolean);
  if (segs.length && /^(USA|US|UNITED STATES(?: OF AMERICA)?)$/i.test(segs[segs.length - 1]!)) segs.pop();
  const raw: Raw = {};
  // Tail: "FL 33125", "FL 33125-1234", "FL", "33125".
  const last = segs[segs.length - 1];
  if (segs.length > 1 && last) {
    const m = /^(?:([A-Za-z]{2}|Florida)\s*)?(\d{5})(?:-(\d{4}))?$/.exec(last) ?? /^([A-Za-z]{2}|Florida)$/.exec(last);
    if (m) {
      segs.pop();
      const st = /^\d/.test(m[1] ?? "") ? undefined : m[1];
      if (st) raw.state = st.length > 2 ? "FL" : st.toUpperCase();
      if (m[2] && /^\d{5}$/.test(m[2])) raw.zip = m[2];
      if (m[3]) raw.zip4 = m[3];
      // "Miami, FL, 33125": state alone in its own segment, ZIP before.
    }
  }
  const lastAgain = segs[segs.length - 1];
  if (segs.length > 1 && lastAgain && /^(?:[A-Za-z]{2}|Florida)$/.test(lastAgain) && !raw.state) {
    raw.state = lastAgain.length > 2 ? "FL" : lastAgain.toUpperCase();
    segs.pop();
  }
  // No commas: "100 NW 7th St Miami FL 33125". Peel state/ZIP off the end, then a known city name.
  if (segs.length === 1 && !raw.state && !raw.zip) {
    const m = /^(.*?)\s+(?:(FL|FLORIDA)\s+)?(\d{5})(?:-(\d{4}))?$/i.exec(segs[0]!) ?? /^(.*?)\s+(FL|FLORIDA)$/i.exec(segs[0]!);
    if (m) {
      segs[0] = m[1]!;
      raw.state = "FL";
      const z = m.length > 3 ? m[3] : undefined;
      if (z) raw.zip = z;
      if (m[4]) raw.zip4 = m[4];
      const words = segs[0].split(/\s+/);
      for (let n = Math.min(4, words.length - 2); n >= 1; n--) {
        const cityWords = words.slice(words.length - n);
        if (countyFromCity(cityWords.join(" "))) {
          raw.city = cityWords.join(" ");
          segs[0] = words.slice(0, words.length - n).join(" ");
          break;
        }
      }
    }
  }
  const countyIdx = segs.findIndex((s, i) => i > 0 && /\bcounty$/i.test(s));
  if (countyIdx > 0) {
    raw.countyName = segs[countyIdx]!;
    segs.splice(countyIdx, 1);
  }
  if (segs.length > 1) raw.city = segs[segs.length - 1]!;
  const streetSeg = segs[0] ?? "";
  // A second segment that is only a unit: "123 Main St, Apt 4B, Miami".
  let street = streetSeg;
  if (segs.length > 2 && /^(?:(?:APT|APARTMENT|UNIT|STE|SUITE|BLDG|LOT|SPC|RM|ROOM)\.?\s*#?\s*|#\s*)\S+$/i.test(segs[1]!)) {
    raw.unit = segs[1]!;
  }
  const tu = TRAILING_UNIT.exec(street);
  if (tu) {
    raw.unit = raw.unit ?? tu[1]!;
    street = street.slice(0, tu.index);
  }
  const nm = /^(\d+[A-Za-z]?(?:\s+\d\/\d)?)\s+(.+)$/.exec(street.trim());
  if (nm) {
    raw.streetNumber = nm[1]!;
    raw.route = nm[2]!;
  } else {
    raw.route = street;
  }
  return raw;
}

export interface NormalizeOptions {
  /** Force the county instead of detecting it. */
  county?: CountyId;
}

/**
 * Turn a Google Places / Geocoding result (or a comma-separated address string) into the street
 * lines each county stores. Throws `InvalidAddressError` without a street number and street name,
 * and `UnsupportedCountyError` for a non-Florida state or a county other than the three supported.
 */
export function normalizeAddress(input: AddressInput, options: NormalizeOptions = {}): NormalizedAddress {
  let raw: Raw | undefined;
  if (typeof input === "string") {
    raw = fromString(input);
  } else {
    raw = fromComponents(input);
    if (!raw || (!raw.streetNumber && !raw.route)) {
      const text = input.formatted_address ?? input.formattedAddress;
      raw = text ? fromString(text) : raw;
    }
  }
  if (!raw || !raw.streetNumber || !raw.route) {
    throw new InvalidAddressError("Address needs a street number and a street name");
  }
  if (raw.state && raw.state.toUpperCase() !== "FL") {
    throw new UnsupportedCountyError(`Only Florida addresses are supported (got state "${raw.state}")`);
  }
  const streetNumber = raw.streetNumber.trim().replace(/\s+/g, " ");
  if (!/^\d+[A-Za-z]?(?: \d\/\d)?$/.test(streetNumber)) {
    throw new InvalidAddressError(`Unsupported street number "${streetNumber}"`);
  }

  let route = raw.route;
  let unit = cleanUnit(raw.unit);
  if (!unit) {
    const tu = TRAILING_UNIT.exec(route);
    if (tu) {
      unit = cleanUnit(tu[1]);
      route = route.slice(0, tu.index);
    }
  }
  const parts = parseRoute(route);

  const county =
    options.county ??
    countyFromName(raw.countyName) ??
    detectCounty(input) ??
    countyFromCity(raw.city);
  if (!options.county && raw.countyName && !countyFromName(raw.countyName)) {
    throw new UnsupportedCountyError(`County "${raw.countyName}" is not supported`, raw.countyName);
  }

  const out: NormalizedAddress = {
    streetNumber: streetNumber.toUpperCase(),
    streetName: parts.names[0]!,
    search: buildSearch({ streetNumber: streetNumber.toUpperCase(), ...parts }),
  };
  if (parts.pre) out.preDirection = parts.pre;
  if (parts.type) out.streetType = parts.type;
  if (parts.post) out.postDirection = parts.post;
  if (unit) out.unit = unit;
  if (raw.city) out.city = raw.city;
  if (raw.state) out.state = raw.state.toUpperCase();
  if (raw.zip && /^\d{5}$/.test(raw.zip.slice(0, 5))) out.zip = raw.zip.slice(0, 5);
  const z4 = raw.zip4 ?? (raw.zip && raw.zip.length >= 9 ? raw.zip.slice(-4) : undefined);
  if (z4 && /^\d{4}$/.test(z4)) out.zip4 = z4;
  if (county) out.county = county;
  return out;
}
