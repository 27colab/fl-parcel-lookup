# fl-parcel-lookup

Look up a Florida parcel's **folio number and legal description** from an address, for **Miami-Dade, Broward and Palm Beach** counties, using each county's public ArcGIS services.

The part that takes the effort is not the HTTP call. It is that each county stores the same street address differently (`NW 7 ST` vs `NW 7TH ST` vs `NW 58th AVE`, units appended or not, a ZIP that is sometimes the owner's mailing ZIP), so a Google Places address rarely matches as typed. This package turns a Places result into the spellings each county uses, queries safely, and tells you when the answer is ambiguous.

```ts
import { lookupByAddress } from "@27colab/fl-parcel-lookup";

// `place` is what Google Places Autocomplete / Geocoding gives you (address_components),
// or just a comma-separated string.
const parcel = await lookupByAddress(place);
// {
//   folio: "0100000000010",
//   situs: "100 NW 7 ST",
//   legal: "EXAMPLE PARK SUBD PB 1-1 LOT 5 BLK 2",
//   county: "miami-dade",
//   coords: { lat: 25.78, lng: -80.2 },
//   source: { county, dataset, url, retrievedAt },
//   candidates: 1, ambiguous: false
// }  // or null when the county has no match
```

## Honest positioning

- It is a **thin, careful client over public county data**, not a data product. It is only as complete and correct as the counties' open-data layers.
- It is a **pre-fill, not a source of truth.** Property appraiser records are not title. If the folio or legal description goes on a legal filing, confirm it against the recorded deed or a title search.
- **Three counties only.** Other counties get a typed `UnsupportedCountyError`. Adding one means implementing `CountyProvider` (about 100 lines).
- **Endpoint drift is the main maintenance risk.** The counties re-publish and rename services without notice. Endpoints and field names are dated in [docs/endpoints.md](docs/endpoints.md), and a weekly [live check](.github/workflows/live.yml) fails when a field disappears.
- **Broward** is two services (address points for the folio, tax roll for legal and owner) and its address points do not cover every building. A `null` there can mean "no address point".
- Not affiliated with any county or appraiser. Data is provided by them "as is".

## Install

```sh
npm install @27colab/fl-parcel-lookup
```

Node 18+ (uses global `fetch`). ESM only. No runtime dependencies. **No Google API key is needed or used here**: you get the Places result in your own app (browser or server) and pass it in.

## API

### `lookupByAddress(input, options?) -> Promise<ParcelRecord | null>`

`input` is a Google place (`address_components`, or the newer `addressComponents`), or a string like `"100 NW 7th St Apt 4B, Miami, FL 33125"`. The county is detected from the Places `administrative_area_level_2`, then an explicit "X County" in text, then a table of well-known cities; pass `{ county }` to skip detection.

Result fields: `folio`, `situs`, `legal` (`null` if the service has none), `county`, `coords?`, `source`, plus `candidates`, `ambiguous` and `unitMatched` so you can tell a sure answer from a guess:

| Situation | Result |
|---|---|
| One parcel matches | `ambiguous: false` |
| Condo building, no unit given | first unit, `ambiguous: true`, `candidates: n`. Use `searchByAddress` to get all of them |
| Unit given and found | `unitMatched: true` |
| Unit given, not found | `null`, or with `{ unitFallback: true }` the building-level match with `unitMatched: false` |
| Nothing | `null` |

### `lookupByFolio(folio, options?)`

Dashes and spaces are accepted. The county is inferred from the folio shape (13 digits Miami-Dade, 17 Palm Beach, 12 alphanumerics Broward) or pass `{ county }`.

### `searchByAddress(input, options?) -> ParcelRecord[]`

Every distinct parcel on the street line (all units of a condo, say).

### `normalizeAddress(input, { county? }) -> NormalizedAddress`

The part you can use on its own, e.g. to feed another system. Returns the parsed pieces (`streetNumber`, `preDirection`, `streetName`, `streetType`, `postDirection`, `unit`, `city`, `zip`, `zip4`, `county`) and `search`, the street lines per county. Each county gets a preferred spelling first and the alternate (with/without ordinal) second:

```ts
normalizeAddress("100 Northwest 7th Street Apt 4B, Miami, FL 33125").search
// "miami-dade": ["100 NW 7 ST", "100 NW 7TH ST"]
// "palm-beach": ["100 NW 7TH ST", "100 NW 7 ST"]
// "broward":    ["100 NW 7TH ST", "100 NW 7 ST"]   unit: "4B"
```

Handles USPS suffix abbreviations, spelled-out and dotted directionals, pre/post directionals, ordinals, units (`Apt`, `Unit`, `#`, `Suite`, a Places `subpremise`), ZIP and ZIP+4 tails. Throws `InvalidAddressError` (no street number or name) or `UnsupportedCountyError` (non-Florida, or another county).

Also handled: spelled-out ordinals (`Seventh Street` -> `7`/`7TH`, spelled form kept as a last-resort variant), road designations (`State Road 7`, `SR-7`, `US-1`, `County Road 702`, with every spelling offered because the counties disagree), and comma-less text (`100 NW 7th St Miami FL 33125`; the city is only peeled off if it is a known city and a state or ZIP is present).

Known gaps: fractional numbers (`100 1/2 Main St`) are passed through as `100 1/2` but I have not verified how the counties store them; city detection and the county fallback rely on a hand-kept table of incorporated cities; no handling of `Avenue of the ...`-style names, intersections or PO boxes.

### `detectCounty(input)`, `detectCountyFromFolio(folio)`, `formatFolio(county, folio)`

### Options

```ts
createClient({
  fetch,              // inject your own (proxy, tests, non-Node runtimes)
  timeoutMs: 10_000,  // per attempt
  retries: 2,         // timeouts, network errors, 429, 5xx, ArcGIS error codes >= 500; exponential backoff + jitter, honours Retry-After
  signal,             // AbortSignal
  userAgent,          // always sent; Broward returns 403 without one
  includeOwner: false,
  includeLegal: true,
  zip: "prefer",      // "prefer" | "require" | "ignore"
  unitFallback: false,
  maxResults: 50,
  providers: [],      // replace or add CountyProviders
});
```

`createClient(defaults)` returns `{ lookupByAddress, searchByAddress, lookupByFolio }`; the top-level functions use default options and every call also accepts per-call overrides.

### Errors

All extend `ParcelLookupError` with a `code` and a `retryable` flag: `InvalidAddressError`, `InvalidFolioError`, `UnsupportedCountyError`, `TimeoutError`, `NetworkError`, `HttpError` (`status`), `ServiceError` (ArcGIS `serviceCode`), `BadResponseError`, `AbortedError`. Messages carry the service URL without its query string.

### `CountyProvider`

```ts
interface CountyProvider {
  id: CountyId; name: string;
  isValidFolio(folio: string): boolean;
  searchByAddress(address: NormalizedAddress, ctx: ProviderContext): Promise<ParcelRecord[]>;
  getByFolio(folio: string, ctx: ProviderContext): Promise<ParcelRecord | null>;
}
```

## Privacy

Owner names and mailing details are public record, but they are still personal data.

- **Owner names are off by default.** Unless you pass `includeOwner: true`, the owner fields are not even requested from the county.
- The library **never logs** anything (no `console` calls). Errors contain the service URL only, never the query or the response body.
- There is **no search by owner**, on purpose.
- Mailing addresses are never read.
- If you do store owner names, you own the retention and use question (some owners are exempt from public disclosure under Florida law; the counties apply those exemptions before publishing, this library does not).

## Querying safely

Street lines are built from a restricted character set and string literals are quoted by doubling `'`; LIKE wildcards cannot come from user input. Matching is a prefix `LIKE` plus an exact client-side check, not a contains-search, so `1 NW 7 ST` does not match `11 NW 7 ST` or `1 NW 7 STATION RD`.

## Tests

```sh
npm test            # unit tests: ~110-case address table, per-county fixtures, error/timeout simulation
npm run test:live   # hits the real services (schema contract + one end-to-end lookup per county)
```

The default run never touches the network. Fixtures in [test/fixtures](test/fixtures) are **invented** (made-up folios, owners and legals) but shaped like the real responses. The live suite asserts shapes only and prints nothing from the responses.

## Development

```sh
npm ci && npm run typecheck && npm test && npm run build
```

Issues are triaged when time allows. This is a reference implementation; pull requests that add a county provider with fixtures and a live schema check are welcome.

## License

MIT
