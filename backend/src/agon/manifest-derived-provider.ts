import {
  inspectManifest,
  assertPublicHttpsDestination,
  ManifestInspectionError,
  type ManifestInspection,
} from "./manifest-inspector.ts";
import { normalizeManifestV2 } from "./core/manifest.ts";
import {
  createHttpPlaygroundProviderRunner,
  PlaygroundProviderError,
  type ListedPlaygroundProvider,
  type PlaygroundProviderRunner,
} from "./playground-provider.ts";
import {
  createHttpAgonEndpointQaRunner,
  AgonEndpointQaError,
  type AgonEndpointQaRunner,
} from "./endpoint-qa.ts";

type ManifestRecord = Record<string, unknown>;

export type ManifestDerivedProviderOptions = {
  /** Optional emergency scope overrides. Manifests remain authoritative when present. */
  overrides?: Readonly<Record<string, string>>;
  fetch?: typeof fetch;
  resolve?: (hostname: string) => Promise<string[]>;
  timeoutMs?: number;
};

function record(value: unknown): ManifestRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ManifestRecord
    : null;
}

function declaredEndpoint(body: unknown, kind: "challenge" | "payment"): string {
  const root = record(body);
  const invocation = record(root?.invocation);
  const certification = record(root?.certification);
  const execution = record(root?.execution);
  const candidates = kind === "challenge"
    ? [certification?.endpoint, execution?.challengeEndpoint, root?.challengeEndpoint, invocation?.challengeEndpoint, invocation?.endpoint, root?.endpoint]
    : [invocation?.endpoint, root?.endpoint];
  const endpoint = candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!endpoint) {
    throw new PlaygroundProviderError("manifest_endpoint_missing", `The manifest does not declare a ${kind} endpoint.`);
  }
  return endpoint.trim();
}

/// The endpoint an agent answers Agon's tests on, read from its service file.
export function testEndpointFromManifest(body: unknown): string {
  return declaredEndpoint(body, "challenge");
}

async function loadManifest(provider: ListedPlaygroundProvider, options: ManifestDerivedProviderOptions): Promise<ManifestInspection> {
  if (!provider.manifestUri || !provider.manifestHash) {
    throw new PlaygroundProviderError("manifest_source_missing", "The listing has no manifest source for automatic certification.");
  }
  let inspection: ManifestInspection;
  try {
    inspection = await inspectManifest(provider.manifestUri, {
      fetch: options.fetch,
      resolve: options.resolve,
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    if (error instanceof ManifestInspectionError) {
      throw new PlaygroundProviderError(`manifest_${error.code.replace(/^manifest_/, "")}`, error.message);
    }
    throw error;
  }
  if (!inspection.validation.ok) {
    throw new PlaygroundProviderError("manifest_invalid", inspection.validation.message);
  }
  const contract = normalizeManifestV2(inspection.body);
  if (!contract.ok) {
    throw new PlaygroundProviderError("manifest_contract_unsupported", contract.message);
  }
  if (inspection.manifestHash.toLowerCase() !== provider.manifestHash.toLowerCase()) {
    throw new PlaygroundProviderError("manifest_hash_mismatch", "The fetched manifest hash does not match the immutable listing version.");
  }
  const identityMatches = contract.value.identity.agentId === provider.agentId
    && contract.value.identity.serviceKey.toLowerCase() === provider.serviceKey.toLowerCase()
    && contract.value.service.version === provider.listingVersion;
  if (!identityMatches) {
    throw new PlaygroundProviderError(
      "manifest_identity_mismatch",
      "The fetched manifest identity does not match the immutable listing agent, service key, and version.",
    );
  }
  return inspection;
}

async function safeEndpoint(value: string, options: ManifestDerivedProviderOptions): Promise<string> {
  try {
    return (await assertPublicHttpsDestination(value, { resolve: options.resolve })).toString();
  } catch (error) {
    if (error instanceof ManifestInspectionError) {
      throw new PlaygroundProviderError(`manifest_${error.code.replace(/^manifest_/, "")}`, error.message);
    }
    throw error;
  }
}

function scope(provider: ListedPlaygroundProvider): string {
  return `${provider.listingReference}@${provider.listingVersion}`.toLowerCase();
}

/**
 * Certification runner that discovers the endpoint from the immutable listing
 * manifest. The configured map is retained only as an emergency compatibility
 * override for older listings that predate manifest source fields.
 */
export function createManifestDerivedPlaygroundProviderRunner(
  options: ManifestDerivedProviderOptions = {},
): PlaygroundProviderRunner {
  const overrides = createHttpPlaygroundProviderRunner(options.overrides ?? {}, options);
  return {
    scopes: () => overrides.scopes(),
    supports(provider) {
      return Boolean(provider.manifestUri && provider.manifestHash) || overrides.supports(provider);
    },
    async run(input) {
      if (input.provider.manifestUri && input.provider.manifestHash) {
        const inspection = await loadManifest(input.provider, options);
        const target = await safeEndpoint(declaredEndpoint(inspection.body, "challenge"), options);
        return createHttpPlaygroundProviderRunner({ [scope(input.provider)]: target }, options).run(input);
      }
      if (overrides.supports(input.provider)) return overrides.run(input);
      throw new PlaygroundProviderError("provider_not_enabled", "This listed agent has no manifest-derived endpoint.");
    },
  };
}

/** Endpoint QA counterpart: discovers the payment endpoint from the manifest. */
export function createManifestDerivedAgonEndpointQaRunner(
  options: ManifestDerivedProviderOptions = {},
): AgonEndpointQaRunner {
  const overrides = createHttpAgonEndpointQaRunner(options.overrides ?? {}, options);
  return {
    scopes: () => overrides.scopes(),
    supports(provider) {
      return Boolean(provider.manifestUri && provider.manifestHash) || overrides.supports(provider);
    },
    async run(input) {
      if (input.provider.manifestUri && input.provider.manifestHash) {
        try {
          const inspection = await loadManifest(input.provider, options);
          const target = await safeEndpoint(declaredEndpoint(inspection.body, "payment"), options);
          return createHttpAgonEndpointQaRunner({ [scope(input.provider)]: target }, options).run(input);
        } catch (error) {
          if (error instanceof PlaygroundProviderError) {
            throw new AgonEndpointQaError(error.code, error.message);
          }
          throw error;
        }
      }
      if (overrides.supports(input.provider)) return overrides.run(input);
      throw new AgonEndpointQaError("endpoint_not_enabled", "This listed agent has no manifest-derived payment endpoint.");
    },
  };
}
