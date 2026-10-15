# Endpoints, field names and terms

All three counties publish their parcel data through public ArcGIS REST services (no key, no login).
Everything below was checked directly against the live services on **2026-10-15** by reading each layer's
`?f=json` metadata and running sample queries. County services are renumbered and re-published without
notice, so treat this file as a dated snapshot. `npm run test:live` re-checks the field names.

| County | Service | Layer | Role |
|---|---|---|---|
| Miami-Dade | `https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/PaParcelView_gdb/FeatureServer/0` | "Property Boundary View" (hosted feature layer, polygons + property appraiser attributes, updated weekly per its item description) | address, folio, legal, owner, centroid |
| Palm Beach | `https://services1.arcgis.com/ZWOoUZbtaYePLlPw/arcgis/rest/services/Parcels_and_Property_Details_WebMercator/FeatureServer/0` | "Parcels and Property Details" (hosted feature layer, owner `PBCGOV_GIS`) | address, folio, legal, owner, centroid |
| Broward | `https://bcgishub.broward.org/server/rest/services/GeoHubDownloads/GISAddressPoints/FeatureServer/0` | "Broward County GIS Address Points" (points) | address -> folio, lat/lng |
| Broward | `https://bcgishub.broward.org/server/rest/services/GeoHubDownloads/BCGIS_Q_BCPA_Parcel_TaxRoll/MapServer/0` | "Q_BCPA_Parcel_TaxRoll" (BCPA parcel joined to tax roll) | folio -> legal, owner, situs parts |

Source pages (human-readable datasets): Miami-Dade Open Data Hub <https://gis-mdc.opendata.arcgis.com/>,
Palm Beach County Open Data <https://opendata2-pbcgov.opendata.arcgis.com/>, Broward GeoHub
<https://geohub-bcgis.opendata.arcgis.com/>. All services allow `maxRecordCount` 2000 and the `Query` operation.

## Fields read

**Miami-Dade** (`FOLIO` 13 digits)
`FOLIO`, `LEGAL`, `TRUE_SITE_ADDR`, `TRUE_SITE_ZIP_CODE`; with owners opted in: `TRUE_OWNER1..3`.
(`TRUE_SITE_CITY`, `TRUE_SITE_UNIT`, `CONDO_FLAG` exist but are not used.)

**Palm Beach** (`PARCEL_NUMBER` 17 digits)
`PARCEL_NUMBER`, `SITE_ADDR_STR`, `LEGAL1..3`; with owners: `OWNER_NAME1..2`.

**Broward** (`FOLIONUMBER` / `FOLIO` 12 alphanumerics)
Address points: `FOLIONUMBER`, `SITUSFULLADDRESS`, `ZIPCODE`, `LATITUDE`, `LONGITUDE`.
Tax roll: `FOLIO`, `LEGAL_LINE_1..14`, `NAME_LINE_1..2` (owners), `SITUS_STREET_NUMBER`, `SITUS_STREET_DIRECTION`,
`SITUS_STREET_NAME`, `SITUS_STREET_TYPE`, `SITUS_STREET_POST_DIR`, `SITUS_UNIT_NUMBER`.

## How each county stores the situs address (observed)

| | Miami-Dade | Palm Beach | Broward |
|---|---|---|---|
| Example | `1502 NW 7 ST` | `2353 SW 8TH ST` | `1317 NW 58th AVE` / `1118 NW 40 TER ` |
| Case | UPPER | UPPER | mixed (`58th`) |
| Ordinals | **stripped** (`NE 1 AVE`) | **kept** (`SW 8TH ST`) | mixed: kept for some streets, stripped for others |
| Suffix | USPS abbreviation | USPS abbreviation | USPS abbreviation |
| Unit | appended to situs (`... 7 ST PKG`), also in `TRUE_SITE_UNIT` | appended (`... N OCEAN BLVD 1601E`) | appended (`... 44 TER 101`), also in `UNITNUMBER` |
| Trailing whitespace | no | no | **yes** on some rows |
| ZIP | `33125-0000` (ZIP+4 style) | `ZIP1` is the owner's **mailing** ZIP: unusable | `ZIPCODE` 5 digits |
| City | `TRUE_SITE_CITY` | `CITYNAME` is the **mailing** city; `MUNICIPALITY` is situs but empty if unincorporated | `CITYNAME` |
| Duplicate rows per folio | **yes** (multi-part polygons, one row per part) | not seen | yes (several address points per folio) |

This table is why the normaliser emits several street-line spellings per county and the providers match
case-insensitively with a prefix `LIKE` and then verify the match client-side.

An earlier approach many integrations take (strip ordinals for every county) fails on Palm Beach today, and
`LIKE '%...%'` contains-matching returns the wrong parcel for short street numbers (`'%1 NW 7 ST%'` also
matches `11 NW 7 ST`). Both are avoided here.

## Quirks that matter

- **Broward answers HTTP 403 to requests without a `User-Agent`** (the default `curl` UA included; a custom
  one works). The library always sends one and `HttpError` mentions it on a 403.
- Broward address points do not cover every building (a sampled public building had no point). `null` from
  `lookupByAddress` means "no address point", not "no parcel". The tax roll has situs parts, but the library does
  not search it by address.
- Broward legal descriptions are stored as up to 14 fixed-width lines (`LEGAL_LINE_n`, 32 chars); lines are
  joined with one space, so a word split across a line break is not re-joined.
- Miami-Dade `X_COORD`/`Y_COORD` are State Plane feet, not lat/lng; coordinates come from `returnCentroid=true`
  with `outSR=4326` instead. Palm Beach is the same. Broward points carry `LATITUDE`/`LONGITUDE`.
- A condo building searched without a unit returns one folio per unit (the result is flagged `ambiguous`).
- ArcGIS returns HTTP 200 with `{ "error": { "code", "message" } }` for bad queries and sometimes for upstream
  timeouts; `ServiceError` exposes the code, and codes >= 500 are retried.
- Hosted layers cap results at `maxRecordCount` (2000); the library asks for 50 by default.

## Terms and rate limits

None of the three services states a rate limit in its metadata. Be a good citizen: use the built-in timeouts and
retries, cache results (parcel data changes weekly at most), and do not bulk-scrape.

- **Miami-Dade** item license text (from the service's `iteminfo`): data is provided "as is", the mapped areas
  are approximate and not for site-specific decisions or financial commitments, and the County assumes no
  responsibility for errors or omissions. Access contact: Miami-Dade County GIS Technical Support Group.
- **Palm Beach** item license text: data is provided "as is" with no warranties and no liability for any use or
  misuse of the data.
- **Broward**: the service metadata carries **no license or terms text** (the address-point description only
  describes update practice). Check the terms on the Broward GeoHub dataset pages before relying on this commercially.

This library is not affiliated with or endorsed by any county or property appraiser. Property appraiser
data is not a legal source of title: use it to pre-fill, then confirm against the official record (for liens
and legal filings, the legal description from the recorded deed or title search).

## Not supported on purpose

Searching by **owner name** is not offered. The services can do it, but it turns a parcel lookup into a
people search. Searching by **legal description** is not offered because the legal text is free-form and
truncated differently per county, so a partial match would be silently wrong. Use `lookupByFolio`.
