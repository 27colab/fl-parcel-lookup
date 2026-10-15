export type CountyId = "miami-dade" | "broward" | "palm-beach";

export const COUNTY_IDS: readonly CountyId[] = ["miami-dade", "broward", "palm-beach"];

export const COUNTY_NAMES: Record<CountyId, string> = {
  "miami-dade": "Miami-Dade County",
  broward: "Broward County",
  "palm-beach": "Palm Beach County",
};

/** One entry of Google's `address_components` (Places JS / Geocoding) or `addressComponents` (Places API New). */
export interface PlaceComponent {
  long_name?: string;
  short_name?: string;
  longText?: string;
  shortText?: string;
  types: string[];
}

/** The subset of a Google place / geocoding result this library reads. */
export interface PlaceLike {
  address_components?: PlaceComponent[];
  addressComponents?: PlaceComponent[];
  formatted_address?: string;
  formattedAddress?: string;
}

export type AddressInput = string | PlaceLike;

export interface NormalizedAddress {
  streetNumber: string;
  /** Pre-directional, e.g. "NW". */
  preDirection?: string;
  /** Street name without type; ordinals kept as given ("7TH"). */
  streetName: string;
  /** USPS abbreviation, e.g. "ST". */
  streetType?: string;
  postDirection?: string;
  /** Unit identifier only, upper-case, no "APT"/"#" prefix. */
  unit?: string;
  city?: string;
  state?: string;
  /** 5-digit ZIP. */
  zip?: string;
  zip4?: string;
  /** From the Places county component, a "Xxx County" substring, or a city heuristic. */
  county?: CountyId;
  /**
   * Street line (no unit, no city) in the form each county stores it. First entry is the
   * preferred spelling; later entries are alternates (ordinal / no ordinal) that providers OR together.
   */
  search: Record<CountyId, string[]>;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface ParcelSource {
  county: CountyId;
  /** Human-readable name of the public dataset. */
  dataset: string;
  /** Service URL (no query string). */
  url: string;
  /** ISO timestamp of the request. */
  retrievedAt: string;
}

export interface ParcelRecord {
  /** Folio / parcel number as the county stores it: no dashes or spaces. */
  folio: string;
  /** Situs (site) address as stored by the county, whitespace-trimmed. */
  situs: string;
  /** Legal description, whitespace-collapsed; null when the service does not publish one. */
  legal: string | null;
  /** Only present when `includeOwner` is set. Public record; see the privacy notes in the README. */
  owner?: string[];
  county: CountyId;
  coords?: Coordinates;
  source: ParcelSource;
  /** Set when a unit was requested: whether the record's unit matched it. */
  unitMatched?: boolean;
  /** lookupByAddress only: number of distinct folios that matched the street line. */
  candidates?: number;
  /** lookupByAddress only: true when more than one folio matched and no unit disambiguated them. */
  ambiguous?: boolean;
}

export type Fetch = typeof fetch;

export type HttpGet = (endpoint: string, params: Record<string, string | number | boolean>) => Promise<unknown>;

export interface ProviderContext {
  http: HttpGet;
  include: { owner: boolean; legal: boolean };
  /** How to use the ZIP: try with it and retry without ("prefer"), only with it, or never. */
  zip: "prefer" | "require" | "ignore";
  /** If a unit was given but not found, return the street-level matches flagged `unitMatched: false`. */
  unitFallback: boolean;
  maxResults: number;
  now: () => Date;
}

export interface CountyProvider {
  readonly id: CountyId;
  readonly name: string;
  isValidFolio(folio: string): boolean;
  searchByAddress(address: NormalizedAddress, ctx: ProviderContext): Promise<ParcelRecord[]>;
  getByFolio(folio: string, ctx: ProviderContext): Promise<ParcelRecord | null>;
}
