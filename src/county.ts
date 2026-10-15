import type { AddressInput, CountyId, PlaceComponent, PlaceLike } from "./types.js";

const COUNTY_PATTERNS: [RegExp, CountyId][] = [
  [/\bmiami[\s-]?dade\b/i, "miami-dade"],
  [/\bbroward\b/i, "broward"],
  [/\bpalm\s+beach\b/i, "palm-beach"],
];

// Heuristic fallback for inputs with no county. Incorporated municipalities only.
const CITY_COUNTY: Record<CountyId, string[]> = {
  "miami-dade": [
    "miami", "miami beach", "hialeah", "coral gables", "homestead", "doral", "aventura", "miami gardens",
    "north miami", "north miami beach", "key biscayne", "cutler bay", "pinecrest", "opa-locka", "opa locka",
    "sweetwater", "miami lakes", "palmetto bay", "south miami", "florida city", "surfside", "bal harbour",
    "miami springs", "medley", "miami shores", "north bay village", "virginia gardens", "west miami",
    "el portal", "biscayne park", "bay harbor islands", "golden beach", "sunny isles beach",
    "hialeah gardens", "indian creek",
  ],
  broward: [
    "fort lauderdale", "ft lauderdale", "hollywood", "pembroke pines", "coral springs", "miramar", "davie",
    "plantation", "sunrise", "pompano beach", "deerfield beach", "lauderhill", "lauderdale lakes",
    "lauderdale-by-the-sea", "weston", "margate", "coconut creek", "tamarac", "oakland park", "dania beach",
    "hallandale beach", "hallandale", "cooper city", "parkland", "north lauderdale", "wilton manors",
    "lighthouse point", "southwest ranches", "hillsboro beach", "sea ranch lakes", "west park",
    "pembroke park", "lazy lake",
  ],
  "palm-beach": [
    "west palm beach", "boca raton", "boynton beach", "delray beach", "jupiter", "palm beach gardens",
    "wellington", "lake worth", "lake worth beach", "riviera beach", "royal palm beach", "greenacres",
    "palm springs", "north palm beach", "belle glade", "lantana", "tequesta", "juno beach", "palm beach",
    "loxahatchee", "pahokee", "haverhill", "highland beach", "ocean ridge", "manalapan", "south bay",
  ],
};

const CITY_LOOKUP = new Map<string, CountyId>();
for (const [county, cities] of Object.entries(CITY_COUNTY) as [CountyId, string[]][]) {
  for (const c of cities) CITY_LOOKUP.set(c, county);
}

export function countyFromName(name: string | undefined): CountyId | undefined {
  if (!name) return undefined;
  for (const [re, id] of COUNTY_PATTERNS) if (re.test(name)) return id;
  return undefined;
}

export function countyFromCity(city: string | undefined): CountyId | undefined {
  if (!city) return undefined;
  return CITY_LOOKUP.get(city.trim().toLowerCase().replace(/\./g, ""));
}

export function componentValue(
  components: PlaceComponent[] | undefined,
  type: string,
  kind: "long" | "short" = "long",
): string | undefined {
  const c = components?.find((x) => x.types.includes(type));
  if (!c) return undefined;
  const v = kind === "long" ? (c.long_name ?? c.longText) : (c.short_name ?? c.shortText);
  return v?.trim() || undefined;
}

export function placeComponents(place: PlaceLike): PlaceComponent[] | undefined {
  return place.address_components ?? place.addressComponents;
}

/**
 * Work out which supported county an address is in.
 * Order: Places `administrative_area_level_2` -> an explicit "<Name> County" in text -> known-city table.
 * The city table is a heuristic; pass `county` explicitly when you know it.
 */
export function detectCounty(input: AddressInput): CountyId | undefined {
  if (typeof input === "string") {
    const m = /\b(miami[\s-]?dade|broward|palm\s+beach)\s+county\b/i.exec(input);
    if (m) return countyFromName(m[1]);
    const segs = input.split(",").map((s) => s.trim());
    return countyFromCity(segs[1]);
  }
  const comps = placeComponents(input);
  const fromComponent = countyFromName(componentValue(comps, "administrative_area_level_2"));
  if (fromComponent) return fromComponent;
  const text = input.formatted_address ?? input.formattedAddress;
  if (text) {
    const m = /\b(miami[\s-]?dade|broward|palm\s+beach)\s+county\b/i.exec(text);
    if (m) return countyFromName(m[1]);
  }
  const city =
    componentValue(comps, "locality") ??
    componentValue(comps, "postal_town") ??
    componentValue(comps, "sublocality_level_1");
  return countyFromCity(city);
}

/** Strip separators and upper-case: "01-4102-089-0001" -> "0141020890001". */
export function cleanFolio(folio: string): string {
  return folio.replace(/[\s\-.]/g, "").toUpperCase();
}

/** Shape-based county detection: 13 digits Miami-Dade, 17 digits Palm Beach, 12 alphanumerics Broward. */
export function detectCountyFromFolio(folio: string): CountyId | undefined {
  const f = cleanFolio(folio);
  if (/^\d{13}$/.test(f)) return "miami-dade";
  if (/^\d{17}$/.test(f)) return "palm-beach";
  if (/^[0-9A-Z]{12}$/.test(f)) return "broward";
  return undefined;
}

/** Display format used by the property appraisers (hyphenated). Returns the input cleaned if the shape is unknown. */
export function formatFolio(county: CountyId, folio: string): string {
  const f = cleanFolio(folio);
  const groups: Record<CountyId, number[]> = {
    "miami-dade": [2, 4, 3, 4],
    "palm-beach": [2, 2, 2, 2, 2, 3, 4],
    broward: [4, 2, 2, 4],
  };
  const g = groups[county];
  if (f.length !== g.reduce((a, b) => a + b, 0)) return f;
  const out: string[] = [];
  let i = 0;
  for (const n of g) {
    out.push(f.slice(i, i + n));
    i += n;
  }
  return out.join("-");
}
