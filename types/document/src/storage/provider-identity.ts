/**
 * Storage provider identity and scope types
 *
 * Defines the identity, scope binding, and fingerprinting types for
 * document storage providers.
 */

// =============================================================================
// Storage Scope
// =============================================================================

/**
 * Identifies the storage partition a provider operates within.
 * Matches the shape already used inline in types-host kernel.ts.
 */
export interface StorageScope {
  readonly tenantId: string | { readonly kind: 'single-tenant' };
  readonly workspaceId: string | { readonly kind: 'no-workspace' };
  readonly documentId?: string;
}

/**
 * Binding that specifies whether a provider is scoped to a particular
 * tenant/workspace/document, or explicitly has no scope.
 */
export type StorageScopeBinding =
  | { readonly kind: 'scoped'; readonly scope: StorageScope }
  | {
      readonly kind: 'explicit-no-scope';
      readonly reason: 'ephemeral-memory' | 'deterministic-test-fixture';
    };

// =============================================================================
// Provider Identity
// =============================================================================

/**
 * Stable identity for a storage provider instance.
 * Enables audit trails, fingerprint verification, and version negotiation.
 */
export interface StorageProviderIdentity {
  /** Unique reference ID for this provider within a document session. */
  readonly providerRefId: string;

  /** Optional persistent identifier across sessions. */
  readonly providerId?: string;

  /** Reference to the authority provider (for replicas/caches). */
  readonly authorityRef?: string;

  /** Scope binding for this provider. */
  readonly storageScope: StorageScopeBinding;

  /**
   * Fingerprint of the provider config with secrets redacted.
   * Used for change detection and audit logging.
   */
  readonly redactedConfigFingerprint?: string;

  /** Version of the storage contract this provider implements. */
  readonly contractVersion: string;

  /** Version of the provider protocol (wire format, etc.). */
  readonly providerProtocolVersion: string;

  /** Version of the storage schema (data format on disk/remote). */
  readonly storageSchemaVersion?: string;
}
