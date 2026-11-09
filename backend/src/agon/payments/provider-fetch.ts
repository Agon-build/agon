import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

import { isPublicAddress } from "../manifest-inspector.ts";

/// Audit B9 (2026-11-09): a provider host was checked at quote time and resolved
/// again when Agon paid it, so a rebinding DNS answer could send the paid call to
/// a private address. Here the check runs inside the connection's own lookup: the
/// address Node connects to is the one that was just checked.

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const NULL_BODY = new Set([101, 204, 205, 304]);

type Resolve = (hostname: string) => Promise<string[]>;

/// A body sent compressed even though identity was asked for, made plain again.
export function decodeBody(body: Buffer, encoding: string | null): Buffer {
  const limit = { maxOutputLength: MAX_BODY_BYTES };
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "": case "identity": return body;
    case "gzip": case "x-gzip": return gunzipSync(body, limit);
    case "deflate": return inflateSync(body, limit);
    case "br": return brotliDecompressSync(body, limit);
    default: throw new Error(`provider sent an unsupported content-encoding: ${encoding}`);
  }
}
const systemResolve: Resolve = async (hostname) => (await dnsLookup(hostname, { all: true })).map((entry) => entry.address);

export class BlockedDestinationError extends Error {
  constructor(hostname: string) {
    super(`Provider host ${hostname} resolves to a private or reserved address.`);
    this.name = "BlockedDestinationError";
  }
}

/// A connection lookup that refuses any private or reserved answer.
export function publicOnlyLookup(resolve: Resolve = systemResolve): LookupFunction {
  return ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    resolve(hostname).then((addresses) => {
      if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
        callback(new BlockedDestinationError(hostname));
        return;
      }
      const entries = addresses.map((address) => ({ address, family: isIP(address) }));
      if (options?.all) callback(null, entries);
      else callback(null, entries[0]!.address, entries[0]!.family);
    }, (error: Error) => callback(error));
  }) as unknown as LookupFunction;
}

/// Fetch for paid provider calls. https goes out through the checked lookup and
/// never follows redirects; anything else (Agon's own services on the internal
/// network) uses the normal fetch.
export function createProviderFetch(options: { resolve?: Resolve; fallback?: typeof fetch } = {}): typeof fetch {
  const lookup = publicOnlyLookup(options.resolve);
  const fallback = options.fallback ?? fetch;
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "https:") return fallback(input, init);
    const headers = new Headers(init?.headers);
    const body = init?.body == null ? null : typeof init.body === "string" ? Buffer.from(init.body) : init.body instanceof Uint8Array ? Buffer.from(init.body) : null;
    if (init?.body != null && body === null) throw new TypeError("provider calls send a string or bytes body");
    if (body) headers.set("content-length", String(body.byteLength));
    // Unlike fetch, this client does not decompress, so ask for a plain body.
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
    return new Promise<Response>((resolve, reject) => {
      const req = https.request(url, {
        method: init?.method ?? "GET",
        headers: Object.fromEntries(headers.entries()),
        lookup,
        servername: url.hostname,
        ...(init?.signal ? { signal: init.signal } : {}),
      }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > MAX_BODY_BYTES) { res.destroy(new Error("provider response is larger than 2 MB")); return; }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const out = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) for (const v of value) out.append(key, v);
            else if (value !== undefined) out.set(key, value);
          }
          const status = res.statusCode ?? 0;
          let raw: Buffer;
          try {
            raw = decodeBody(Buffer.concat(chunks), out.get("content-encoding"));
          } catch (error) {
            reject(error);
            return;
          }
          out.delete("content-encoding");
          out.delete("content-length");
          resolve(new Response(NULL_BODY.has(status) ? null : raw, { status, statusText: res.statusMessage ?? "", headers: out }));
        });
        res.on("error", reject);
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }) as typeof fetch;
}
