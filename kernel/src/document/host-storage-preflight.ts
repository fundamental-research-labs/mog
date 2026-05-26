/**
 * Authorized Storage Preflight
 *
 * Minimal provider identity/preflight for host-backed document construction.
 * Validates that storage provider configs join to authorized provider summaries,
 * enforces required provider presence, and determines readiness targets.
 *
 * This is NOT the full the storage provider lifecycle provider registry — it handles structural
 * matching of storage configs to authorized providers. Provider materializer
 * capabilities are checked during validation (in validate.ts).
 *
 * Fail-closed: any unsupported non-ephemeral storage shape throws
 * `StoragePreflightError`.
 */

import type { HostDiagnosticsSink } from '@mog-sdk/types-host/diagnostics';
import type { HostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import type {
  StorageScope,
  StorageScopeBinding,
} from '@mog-sdk/types-document/storage/provider-identity';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface ProviderPreflightConfig {
  readonly authorizedProviders: readonly AuthorizedProviderSummary[];
  readonly storageProviders: readonly StorageProviderConfig[];
  readonly durability: 'ephemeral' | 'durableLocal';
  readonly storageConstraint: 'as-requested' | 'read-only' | 'ephemeral';
  readonly diagnostics: HostDiagnosticsSink;
}

export interface AuthorizedProviderSummary {
  readonly providerRefId: string;
  readonly providerId?: string;
  readonly kind: string;
  readonly role: string;
  readonly required: boolean;
  readonly rawByteExposure: string;
  readonly authorityRef?: string;
  readonly storageScope?: {
    readonly tenantId: string | { readonly kind: 'single-tenant' };
    readonly workspaceId: string | { readonly kind: 'no-workspace' };
    readonly documentId?: string;
  };
  readonly redactedConfigFingerprint?: HostCanonicalFingerprint;
}

export interface StorageProviderConfig {
  readonly providerRefId: string;
  readonly kind: string;
  readonly role: string;
  readonly authorityRef?: string;
  readonly storageScope?: StorageScope | StorageScopeBinding;
  readonly redactedConfigFingerprint?: HostCanonicalFingerprint;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface PreflightResult {
  readonly mode: 'ephemeral-zero-provider' | 'provider-backed';
  readonly matchedProviders: readonly MatchedProvider[];
  readonly readinessTarget: ProviderReadiness;
}

export interface MatchedProvider {
  readonly providerRefId: string;
  readonly kind: string;
  readonly role: string;
  readonly required: boolean;
  readonly authorityRef?: string;
  readonly storageScope?: AuthorizedProviderSummary['storageScope'];
  readonly redactedConfigFingerprint?: HostCanonicalFingerprint;
}

export type ProviderReadiness = 'readyEphemeral' | 'readyReadOnly' | 'readyReadWrite';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class StoragePreflightError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StoragePreflightError';
  }
}

// ---------------------------------------------------------------------------
// Diagnostics helper
// ---------------------------------------------------------------------------

function emitPreflightDiagnostic(
  diagnostics: HostDiagnosticsSink,
  code: string,
  providerRefId: string,
  phase: string,
  providerId?: string,
): void {
  diagnostics.emit({
    kind: 'storage.failure',
    code,
    correlationId: '',
    providerRefId,
    providerId,
    phase,
    timestamp: Date.now(),
  });
}

function emitPreflightSuccess(diagnostics: HostDiagnosticsSink, code: string, phase: string): void {
  diagnostics.emit({
    kind: 'storage.failure',
    code,
    correlationId: '',
    providerRefId: '*',
    phase,
    timestamp: Date.now(),
  });
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJsonStringify(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`)
      .join(',')}}`;
  }
  return 'null';
}

function normalizeStorageScope(
  value: StorageScope | StorageScopeBinding | null | undefined,
): StorageScope | null {
  if (!value) {
    return null;
  }
  if ('kind' in value) {
    return value.kind === 'scoped' ? value.scope : null;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Readiness target resolution
// ---------------------------------------------------------------------------

function resolveReadinessTarget(
  storageConstraint: ProviderPreflightConfig['storageConstraint'],
): ProviderReadiness {
  switch (storageConstraint) {
    case 'ephemeral':
      return 'readyEphemeral';
    case 'read-only':
      return 'readyReadOnly';
    case 'as-requested':
      return 'readyReadWrite';
  }
}

// ---------------------------------------------------------------------------
// Main preflight function
// ---------------------------------------------------------------------------

/**
 * Validate that the storage provider configuration joins correctly to the
 * set of authorized providers from the storage handoff.
 *
 * Returns a `PreflightResult` describing the matched providers and the
 * readiness target the lifecycle system must reach before the handle is
 * usable.
 *
 * @throws StoragePreflightError on any validation failure (fail-closed)
 */
export function preflightAuthorizedStorage(config: ProviderPreflightConfig): PreflightResult {
  const { authorizedProviders, storageProviders, durability, storageConstraint, diagnostics } =
    config;

  // -------------------------------------------------------------------------
  // 1. Ephemeral zero-provider mode
  // -------------------------------------------------------------------------

  if (
    durability === 'ephemeral' &&
    authorizedProviders.length === 0 &&
    storageProviders.length === 0
  ) {
    emitPreflightSuccess(diagnostics, 'PREFLIGHT_EPHEMERAL_ZERO_PROVIDER', 'preflight');
    return {
      mode: 'ephemeral-zero-provider',
      matchedProviders: [],
      readinessTarget: 'readyEphemeral',
    };
  }

  // Ephemeral durability with non-empty providers or authorized providers
  // is not zero-provider mode — fall through to provider matching.

  // -------------------------------------------------------------------------
  // 2. Provider matching: each storageProvider must join to exactly one
  //    authorizedProvider by providerRefId + kind + role. There is no
  //    kind+role fallback because providerRefId is the authorization join key.
  // -------------------------------------------------------------------------

  // Track which authorized providers have been matched (by providerRefId)
  const matchedAuthorizedRefIds = new Set<string>();
  const matchedProviders: MatchedProvider[] = [];

  for (const storageProvider of storageProviders) {
    if (!storageProvider.providerRefId) {
      emitPreflightDiagnostic(
        diagnostics,
        'PREFLIGHT_PROVIDER_REF_ID_MISSING',
        `<missing:${storageProvider.kind}:${storageProvider.role}>`,
        'preflight',
      );
      throw new StoragePreflightError(
        'PROVIDER_REF_ID_MISSING',
        `Storage provider (kind=${storageProvider.kind}, role=${storageProvider.role}) is missing providerRefId`,
      );
    }

    const matched = authorizedProviders.find(
      (ap) =>
        ap.providerRefId === storageProvider.providerRefId &&
        ap.kind === storageProvider.kind &&
        ap.role === storageProvider.role &&
        ap.authorityRef === storageProvider.authorityRef &&
        canonicalJsonStringify(normalizeStorageScope(ap.storageScope)) ===
          canonicalJsonStringify(normalizeStorageScope(storageProvider.storageScope)) &&
        ap.redactedConfigFingerprint === storageProvider.redactedConfigFingerprint,
    );

    if (!matched) {
      const byRefId = authorizedProviders.find(
        (ap) => ap.providerRefId === storageProvider.providerRefId,
      );

      if (byRefId) {
        if (byRefId.kind !== storageProvider.kind) {
          emitPreflightDiagnostic(
            diagnostics,
            'PREFLIGHT_PROVIDER_KIND_MISMATCH',
            storageProvider.providerRefId,
            'preflight',
          );
          throw new StoragePreflightError(
            'PROVIDER_KIND_MISMATCH',
            `Storage provider '${storageProvider.providerRefId}' kind '${storageProvider.kind}' does not match authorized kind '${byRefId.kind}'`,
          );
        }
        if (byRefId.role !== storageProvider.role) {
          emitPreflightDiagnostic(
            diagnostics,
            'PREFLIGHT_PROVIDER_ROLE_MISMATCH',
            storageProvider.providerRefId,
            'preflight',
          );
          throw new StoragePreflightError(
            'PROVIDER_ROLE_MISMATCH',
            `Storage provider '${storageProvider.providerRefId}' role '${storageProvider.role}' does not match authorized role '${byRefId.role}'`,
          );
        }
        if (byRefId.authorityRef !== storageProvider.authorityRef) {
          emitPreflightDiagnostic(
            diagnostics,
            'PREFLIGHT_PROVIDER_AUTHORITY_REF_MISMATCH',
            storageProvider.providerRefId,
            'preflight',
          );
          throw new StoragePreflightError(
            'PROVIDER_AUTHORITY_REF_MISMATCH',
            `Storage provider '${storageProvider.providerRefId}' authorityRef does not match authorized authorityRef`,
          );
        }
        if (
          canonicalJsonStringify(normalizeStorageScope(byRefId.storageScope)) !==
          canonicalJsonStringify(normalizeStorageScope(storageProvider.storageScope))
        ) {
          emitPreflightDiagnostic(
            diagnostics,
            'PREFLIGHT_PROVIDER_STORAGE_SCOPE_MISMATCH',
            storageProvider.providerRefId,
            'preflight',
          );
          throw new StoragePreflightError(
            'PROVIDER_STORAGE_SCOPE_MISMATCH',
            `Storage provider '${storageProvider.providerRefId}' storageScope does not match authorized storageScope`,
          );
        }
        if (byRefId.redactedConfigFingerprint !== storageProvider.redactedConfigFingerprint) {
          emitPreflightDiagnostic(
            diagnostics,
            'PREFLIGHT_PROVIDER_REDACTED_CONFIG_FINGERPRINT_MISMATCH',
            storageProvider.providerRefId,
            'preflight',
          );
          throw new StoragePreflightError(
            'PROVIDER_REDACTED_CONFIG_FINGERPRINT_MISMATCH',
            `Storage provider '${storageProvider.providerRefId}' redactedConfigFingerprint does not match authorized fingerprint`,
          );
        }
      }

      emitPreflightDiagnostic(
        diagnostics,
        'PREFLIGHT_PROVIDER_NOT_AUTHORIZED',
        storageProvider.providerRefId,
        'preflight',
      );
      throw new StoragePreflightError(
        'PROVIDER_NOT_AUTHORIZED',
        `Storage provider '${storageProvider.providerRefId}' (kind=${storageProvider.kind}, role=${storageProvider.role}) has no matching authorized provider`,
      );
    }

    matchedAuthorizedRefIds.add(matched.providerRefId);
    matchedProviders.push({
      providerRefId: matched.providerRefId,
      kind: matched.kind,
      role: matched.role,
      required: matched.required,
      authorityRef: matched.authorityRef,
      storageScope: matched.storageScope,
      redactedConfigFingerprint: matched.redactedConfigFingerprint,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Required provider enforcement: every authorized provider with
  //    required: true must have a matching storage config entry.
  // -------------------------------------------------------------------------

  for (const authorized of authorizedProviders) {
    if (authorized.required && !matchedAuthorizedRefIds.has(authorized.providerRefId)) {
      emitPreflightDiagnostic(
        diagnostics,
        'PREFLIGHT_REQUIRED_PROVIDER_UNMATCHED',
        authorized.providerRefId,
        'preflight',
        authorized.providerId,
      );
      throw new StoragePreflightError(
        'REQUIRED_PROVIDER_UNMATCHED',
        `Required authorized provider '${authorized.providerRefId}' (kind=${authorized.kind}, role=${authorized.role}) has no matching storage config entry`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 4. Durable/required fail-closed: if durability !== 'ephemeral' and
  //    there are zero matched providers, fail closed.
  // -------------------------------------------------------------------------

  if (durability !== 'ephemeral' && matchedProviders.length === 0) {
    emitPreflightDiagnostic(diagnostics, 'PREFLIGHT_DURABLE_NO_PROVIDERS', '*', 'preflight');
    throw new StoragePreflightError(
      'DURABLE_STORAGE_NO_PROVIDERS',
      `Durable storage requires at least one matched provider, but none were matched`,
    );
  }

  // -------------------------------------------------------------------------
  // 5. Readiness target
  // -------------------------------------------------------------------------

  const readinessTarget = resolveReadinessTarget(storageConstraint);

  // -------------------------------------------------------------------------
  // 6. Emit success diagnostic
  // -------------------------------------------------------------------------

  emitPreflightSuccess(diagnostics, 'PREFLIGHT_SUCCESS', 'preflight');

  return {
    mode: 'provider-backed',
    matchedProviders,
    readinessTarget,
  };
}
