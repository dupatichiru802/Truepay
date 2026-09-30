import type { AccountLookup, AccountVerificationProvider } from "./types.js";

export interface HttpProviderOptions {
  /** Full endpoint URL of the verification service. */
  url: string;
  /** Extra headers, e.g. `{ Authorization: "Bearer ..." }` or an API-key header. Never logged. */
  headers?: Record<string, string>;
  /** Build the JSON request body. Defaults to `{ bsb, accountNumber }`. */
  buildRequest?: (bsb: string, accountNumber: string) => unknown;
  /** Map the vendor's JSON response to an `AccountLookup`. Defaults to `{ exists, accountName }`. */
  mapResponse?: (json: unknown) => AccountLookup;
  /** HTTP statuses meaning "no such account" (default `[404]`). Other non-2xx responses throw. */
  notFoundStatuses?: number[];
  /** Per-request timeout in ms (default 5000). */
  timeoutMs?: number;
  /** Retries on network errors, 429 and 5xx (default 1). */
  retries?: number;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

const defaultMap = (json: unknown): AccountLookup => {
  const j = (json ?? {}) as { exists?: unknown; accountName?: unknown };
  const accountName = typeof j.accountName === "string" && j.accountName ? j.accountName : undefined;
  return { exists: j.exists === true || (j.exists === undefined && !!accountName), accountName };
};

/**
 * Generic JSON-over-HTTPS adapter. Point it at a vendor or your own bank gateway and
 * supply `buildRequest` / `mapResponse` to match their contract. Failures throw, which
 * the middleware reports as `provider_error` (502) without exposing details.
 */
export class HttpProvider implements AccountVerificationProvider {
  private readonly opts: Required<Pick<HttpProviderOptions, "timeoutMs" | "retries" | "notFoundStatuses">> &
    HttpProviderOptions;

  constructor(opts: HttpProviderOptions) {
    if (!/^https:\/\//i.test(opts.url) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(opts.url)) {
      throw new Error("HttpProvider url must be https (http allowed only for localhost)");
    }
    this.opts = { timeoutMs: 5000, retries: 1, notFoundStatuses: [404], ...opts };
  }

  async lookupAccount(bsb: string, accountNumber: string): Promise<AccountLookup> {
    const { url, headers, buildRequest, mapResponse, notFoundStatuses, timeoutMs, retries } = this.opts;
    const doFetch = this.opts.fetch ?? fetch;
    const body = JSON.stringify(buildRequest ? buildRequest(bsb, accountNumber) : { bsb, accountNumber });

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", ...headers },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (notFoundStatuses.includes(res.status)) return { exists: false };
        if (res.status === 429 || res.status >= 500) throw new Error(`Provider HTTP ${res.status}`);
        if (!res.ok) {
          // Client errors won't succeed on retry.
          throw Object.assign(new Error(`Provider HTTP ${res.status}`), { permanent: true });
        }
        return (mapResponse ?? defaultMap)(await res.json());
      } catch (err) {
        lastErr = err;
        if ((err as { permanent?: boolean }).permanent) break;
      }
    }
    throw lastErr;
  }
}
