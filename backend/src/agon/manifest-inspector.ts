import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { canonicalManifestHash, validateManifest } from "./core/manifest.ts";

const MAX_MANIFEST_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export type ManifestInspection = {
  uri: string;
  manifestHash: `0x${string}`;
  body: unknown;
  contentType: string | null;
  byteLength: number;
  validation: ReturnType<typeof validateManifest>;
};

export class ManifestInspectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ManifestInspectionError";
    this.code = code;
  }
}

export function publicHttpsUri(value: string): URL {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw new ManifestInspectionError("manifest_uri_invalid", "Manifest URL must be a valid HTTPS URL.");
  }
  if (uri.protocol !== "https:" || uri.username || uri.password || uri.hash) {
    throw new ManifestInspectionError("manifest_uri_invalid", "Manifest URL must use public HTTPS without credentials or fragments.");
  }
  const hostname = uri.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname === "::1"
    || hostname === "0.0.0.0"
    || /^127\./.test(hostname)
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^169\.254\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    || /^fc|^fd|^fe[89a-f]/.test(hostname)
  ) {
    throw new ManifestInspectionError("manifest_uri_blocked", "Manifest URL points to a private or reserved network.");
  }
  return uri;
}

// Private, reserved, shared, documentation, multicast and broadcast ranges.
// Every IPv4-mapped IPv6 address is refused outright rather than unwrapped.
// The lists stay separate because Node matches IPv4 input against the mapped
// IPv6 rule, which would otherwise refuse every IPv4 address.
const NON_PUBLIC_V4 = new BlockList();
const NON_PUBLIC_V6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) NON_PUBLIC_V4.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) NON_PUBLIC_V6.addSubnet(network, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(value);
  if (family === 4) return !NON_PUBLIC_V4.check(value, "ipv4");
  if (family === 6) return !NON_PUBLIC_V6.check(value, "ipv6");
  return false;
}

/** Validate and resolve a provider destination before making a request. */
export async function assertPublicHttpsDestination(
  value: string,
  options: { resolve?: (hostname: string) => Promise<string[]> } = {},
): Promise<URL> {
  const uri = publicHttpsUri(value.trim());
  const resolve = options.resolve ?? (async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address));
  try {
    const addresses = await resolve(uri.hostname);
    if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
      throw new ManifestInspectionError("manifest_uri_blocked", "Provider endpoint resolves to a private or reserved network.");
    }
  } catch (error) {
    if (error instanceof ManifestInspectionError) throw error;
    throw new ManifestInspectionError("manifest_dns_failed", "The provider endpoint host could not be safely resolved.");
  }
  return uri;
}

async function readBounded(response: Response): Promise<{ text: string; byteLength: number }> {
  if (!response.body) return { text: "", byteLength: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      byteLength += next.value.byteLength;
      if (byteLength > MAX_MANIFEST_BYTES) {
        await reader.cancel("manifest size limit exceeded");
        throw new ManifestInspectionError("manifest_too_large", "The manifest is larger than 64 KiB.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength).toString("utf8"), byteLength };
}

export async function inspectManifest(
  value: string,
  options: { fetch?: typeof fetch; timeoutMs?: number; resolve?: (hostname: string) => Promise<string[]> } = {},
): Promise<ManifestInspection> {
  const uri = publicHttpsUri(value.trim());
  const resolve = options.resolve ?? (async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address));
  try {
    const addresses = await resolve(uri.hostname);
    if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
      throw new ManifestInspectionError("manifest_uri_blocked", "Manifest URL resolves to a private or reserved network.");
    }
  } catch (error) {
    if (error instanceof ManifestInspectionError) throw error;
    throw new ManifestInspectionError("manifest_dns_failed", "The manifest host could not be safely resolved.");
  }

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(uri, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json", "user-agent": "agon-manifest-inspector/1" },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new ManifestInspectionError("manifest_unavailable", "The manifest URL did not respond.");
  }
  if (!response.ok) {
    throw new ManifestInspectionError("manifest_http_failed", `The manifest returned HTTP ${response.status}.`);
  }
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_MANIFEST_BYTES) {
    throw new ManifestInspectionError("manifest_too_large", "The manifest is larger than 64 KiB.");
  }
  const raw = await readBounded(response);
  let body: unknown;
  try {
    body = JSON.parse(raw.text) as unknown;
  } catch {
    throw new ManifestInspectionError("manifest_invalid_json", "The manifest did not contain valid JSON.");
  }
  return {
    uri: uri.toString(),
    manifestHash: canonicalManifestHash(body),
    body,
    contentType: response.headers.get("content-type"),
    byteLength: raw.byteLength,
    validation: validateManifest(body),
  };
}

/** Refuse publication until the public file is the exact valid version being anchored. */
export async function verifyHostedManifestHash(
  uri: string,
  expectedHash: string,
  inspect: (uri: string) => Promise<ManifestInspection> = inspectManifest,
): Promise<ManifestInspection> {
  const hosted = await inspect(uri);
  if (!hosted.validation.ok) {
    throw new ManifestInspectionError("manifest_invalid", "The hosted service file is invalid. Upload the reviewed file before publishing.");
  }
  if (hosted.manifestHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new ManifestInspectionError("manifest_hash_mismatch", "The hosted service file differs from the reviewed version. Upload it to a permanent version-specific URL before publishing.");
  }
  return hosted;
}
