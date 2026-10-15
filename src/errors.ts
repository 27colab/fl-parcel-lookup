/**
 * Typed errors. Messages and fields never contain query strings or owner data:
 * `endpoint` is the service URL without its query.
 */
export type ErrorCode =
  | "INVALID_ADDRESS"
  | "UNSUPPORTED_COUNTY"
  | "INVALID_FOLIO"
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP"
  | "SERVICE"
  | "BAD_RESPONSE"
  | "ABORTED";

export class ParcelLookupError extends Error {
  readonly code: ErrorCode;
  /** True when retrying the same request later may succeed. */
  readonly retryable: boolean;
  constructor(code: ErrorCode, message: string, retryable = false, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.retryable = retryable;
  }
}

export class InvalidAddressError extends ParcelLookupError {
  constructor(message: string) {
    super("INVALID_ADDRESS", message);
  }
}

export class InvalidFolioError extends ParcelLookupError {
  constructor(message: string) {
    super("INVALID_FOLIO", message);
  }
}

export class UnsupportedCountyError extends ParcelLookupError {
  readonly county?: string;
  constructor(message: string, county?: string) {
    super("UNSUPPORTED_COUNTY", message);
    if (county !== undefined) this.county = county;
  }
}

export class TimeoutError extends ParcelLookupError {
  readonly endpoint: string;
  readonly timeoutMs: number;
  constructor(endpoint: string, timeoutMs: number) {
    super("TIMEOUT", `Request to ${endpoint} timed out after ${timeoutMs} ms`, true);
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
  }
}

export class NetworkError extends ParcelLookupError {
  readonly endpoint: string;
  constructor(endpoint: string, cause: unknown) {
    super("NETWORK", `Network error calling ${endpoint}`, true, { cause });
    this.endpoint = endpoint;
  }
}

export class HttpError extends ParcelLookupError {
  readonly endpoint: string;
  readonly status: number;
  constructor(endpoint: string, status: number) {
    super(
      "HTTP",
      `HTTP ${status} from ${endpoint}` +
        (status === 403 ? " (some county servers reject requests without a User-Agent header)" : ""),
      status === 429 || status >= 500,
    );
    this.endpoint = endpoint;
    this.status = status;
  }
}

/** ArcGIS answered HTTP 200 with an `{ error: { code, message } }` body. */
export class ServiceError extends ParcelLookupError {
  readonly endpoint: string;
  readonly serviceCode: number;
  constructor(endpoint: string, serviceCode: number, detail: string) {
    super("SERVICE", `ArcGIS error ${serviceCode} from ${endpoint}: ${detail}`, serviceCode >= 500);
    this.endpoint = endpoint;
    this.serviceCode = serviceCode;
  }
}

export class BadResponseError extends ParcelLookupError {
  readonly endpoint: string;
  constructor(endpoint: string, what: string) {
    super("BAD_RESPONSE", `Unexpected response from ${endpoint}: ${what}`);
    this.endpoint = endpoint;
  }
}

export class AbortedError extends ParcelLookupError {
  constructor() {
    super("ABORTED", "Lookup aborted by caller");
  }
}
