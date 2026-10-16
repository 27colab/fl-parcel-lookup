# @27colab/fl-parcel-lookup

Look up a Florida parcel's folio number and legal description from an address, for Miami-Dade, Broward and Palm Beach, using each county's public ArcGIS services.

[![CI](https://github.com/27colab/fl-parcel-lookup/actions/workflows/ci.yml/badge.svg)](https://github.com/27colab/fl-parcel-lookup/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@27colab/fl-parcel-lookup)](https://www.npmjs.com/package/@27colab/fl-parcel-lookup)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![types: TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6.svg)](https://www.typescriptlang.org/)

## Why

- **The hard part is the address, not the HTTP call.** Each county spells the same street differently (`NW 7 ST` vs `NW 7TH ST`, units appended or not), so a Google Places address rarely matches as typed. `normalizeAddress` produces each county's spellings.
- **It tells you when it is guessing.** Results carry `ambiguous`, `candidates` and `unitMatched`; a condo building with no unit given is flagged, not silently resolved.
- **Careful by default.** Owner names are off unless you ask, nothing is logged, there is no owner search, and queries use a restricted character set with exact client-side matching. 170 offline tests plus an opt-in live suite.

## Install

```bash
npm install @27colab/fl-parcel-lookup
```

Node 18+ (global `fetch`), ESM, zero runtime dependencies, TypeScript types included.

## Quickstart

Runs offline against a stubbed county service with invented data.

```ts
import { createClient, normalizeAddress, type Fetch } from '@27colab/fl-parcel-lookup';

// Address normalisation is pure and offline: each county gets its own spelling.
const n = normalizeAddress('100 Northwest 7th Street Apt 4B, Miami, FL 33125');
console.log(n.county, n.unit, n.search['miami-dade'], n.search['palm-beach']);

// A lookup against a stubbed county service (invented data, no network).
const stub: Fetch = async () =>
  new Response(JSON.stringify({ features: [{
    attributes: { FOLIO: '0100000000010', LEGAL: 'EXAMPLE PARK SUBD PB 1-1 LOT 5 BLK 2',
                  TRUE_SITE_ADDR: '100 NW 7 ST', TRUE_SITE_ZIP_CODE: '33125-0000' },
    centroid: { x: -80.2, y: 25.78 },
  }] }), { status: 200, headers: { 'content-type': 'application/json' } });

const parcels = createClient({ fetch: stub });   // drop `fetch` to query the real county services
const parcel = await parcels.lookupByAddress('100 NW 7th St, Miami, FL 33125');
console.log(parcel?.folio, parcel?.county, parcel?.legal, 'ambiguous:', parcel?.ambiguous);
```

Output:

```
miami-dade 4B [ '100 NW 7 ST', '100 NW 7TH ST' ] [ '100 NW 7TH ST', '100 NW 7 ST' ]
0100000000010 miami-dade EXAMPLE PARK SUBD PB 1-1 LOT 5 BLK 2 ambiguous: false
```

## Bring your own keys

None. The county services are public and unauthenticated. No Google API key is used here: you get the Places result in your own app (a Google Places key is yours) and pass it in, or pass a plain address string.

## API

| Export | Purpose |
|---|---|
| `lookupByAddress(input, opts?)` | Best parcel for a Places result or address string, or `null`. |
| `searchByAddress(input, opts?)` | Every distinct parcel on the street line (e.g. all units of a condo). |
| `lookupByFolio(folio, opts?)` | By folio; county inferred from its shape. |
| `normalizeAddress(input, { county? })` | Parsed address plus per-county street spellings; usable on its own. |
| `detectCounty`, `detectCountyFromFolio`, `formatFolio` | County helpers. |
| `createClient(defaults)` | Bind options: `fetch`, `timeoutMs`, `retries`, `signal`, `includeOwner`, `unitFallback`, `providers`. |
| `CountyProvider` | Interface for adding a county (about 100 lines). |
| Errors | `ParcelLookupError` subclasses with `code` and `retryable`, e.g. `UnsupportedCountyError`, `TimeoutError`, `HttpError`. |

Full reference: **[docs.27colab.com/integrations/fl-parcel-lookup](https://docs.27colab.com/integrations/fl-parcel-lookup/)**

## Limits

- **A pre-fill, not a source of truth.** Property appraiser records are not title. If a folio or legal description goes on a legal filing, confirm it against the recorded deed or a title search.
- Only as complete and correct as the counties' open-data layers. Broward address points do not cover every building, so a `null` there can mean "no address point".
- Endpoint drift is the main maintenance risk: counties rename services without notice. Endpoints are dated in [docs/endpoints.md](docs/endpoints.md) and a [scheduled live check](.github/workflows/live.yml) is meant to catch missing fields.
- Known address gaps: fractional numbers, intersections, PO boxes, and a hand-kept table of cities for county detection.
- Not affiliated with any county or appraiser; data is theirs, "as is".

## Not for you if…

- The result goes on a legal filing unchecked.
- You need a county other than Miami-Dade, Broward or Palm Beach (you get `UnsupportedCountyError` unless you add a provider).
- You want a data product or owner search. This is a thin client over public data, and owner search is absent on purpose.

## Develop

```bash
npm ci && npm test && npm run typecheck
npm run test:live   # hits the real county services; opt-in
```

MIT, see [LICENSE](LICENSE).

---

Built by [Jesus Vasquez](https://github.com/vasquezjesus2710) · [27 Colab](https://27colab.com)
