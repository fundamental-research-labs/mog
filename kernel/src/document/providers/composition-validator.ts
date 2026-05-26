/**
 * Composition Validator (the storage provider lifecycle)
 *
 * Pure validation logic for storage provider composition rules.
 * No side effects — takes a DocumentStorageConfig and returns a
 * CompositionValidationResult describing validity, violations,
 * and effective durability.
 *
 * Rules enforced:
 *   1. Exactly one writable authority (unless multi-authority is explicit)
 *   2. Cache-only compositions are invalid for remoteBacked durability
 *   3. ExportSink providers don't satisfy durability requirements
 *   4. Snapshot providers force read-only unless paired with an import path
 *   5. Durability mode requirements (ephemeral, durableLocal, localFirst, etc.)
 *   6. Kind–role compatibility
 *   7. Contract version compatibility across providers
 */

import type {
  DocumentDurabilityMode,
  DocumentStorageConfig,
  StorageProviderKind,
  StorageProviderRole,
} from '@mog-sdk/types-document/storage/document-provider';
import type { StorageProviderConfig } from '@mog-sdk/types-document/storage/provider-configs';
import type {
  CompositionValidationResult,
  CompositionViolation,
} from '@mog-sdk/types-document/storage/composition';
import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';

// =============================================================================
// Kind–Role Compatibility Table
// =============================================================================

/**
 * Defines which roles each provider kind can serve, and whether the kind
 * is considered durable and/or writable.
 */
interface KindTraits {
  supportedRoles: readonly StorageProviderRole[];
  durable: boolean;
  writable: boolean;
}

const KIND_TRAITS: Record<StorageProviderKind, KindTraits> = {
  memory: {
    supportedRoles: ['authority', 'cache'],
    durable: false,
    writable: true,
  },
  indexeddb: {
    supportedRoles: ['authority', 'cache'],
    durable: true,
    writable: true,
  },
  filesystem: {
    supportedRoles: ['authority', 'cache', 'snapshot'],
    durable: true,
    writable: true,
  },
  tauriSidecar: {
    supportedRoles: ['authority'],
    durable: true,
    writable: true,
  },
  remoteApi: {
    supportedRoles: ['authority', 'replica', 'cache'],
    durable: true,
    writable: true,
  },
  objectStore: {
    supportedRoles: ['authority', 'snapshot', 'exportSink'],
    durable: true,
    writable: true,
  },
  databaseLog: {
    supportedRoles: ['authority', 'replica'],
    durable: true,
    writable: true,
  },
  hostCallback: {
    supportedRoles: ['authority', 'cache', 'exportSink'],
    durable: true,
    writable: true,
  },
  readOnlySnapshot: {
    supportedRoles: ['snapshot'],
    durable: false,
    writable: false,
  },
  redactedPublishedSnapshot: {
    supportedRoles: ['snapshot'],
    durable: false,
    writable: false,
  },
  test: {
    supportedRoles: ['authority', 'cache', 'replica', 'snapshot', 'exportSink'],
    durable: false,
    writable: true,
  },
};

// =============================================================================
// Durability Mode Requirements
// =============================================================================

interface DurabilityRule {
  /** At least one provider must be durable? */
  requiresDurable: boolean;
  /** At least one durable provider must be required (not optional)? */
  requiresDurableRequired: boolean;
  /** At least one authority must be writable? */
  requiresWritableAuthority: boolean;
}

const DURABILITY_RULES: Record<DocumentDurabilityMode, DurabilityRule> = {
  ephemeral: {
    requiresDurable: false,
    requiresDurableRequired: false,
    requiresWritableAuthority: false,
  },
  durableLocal: {
    requiresDurable: true,
    requiresDurableRequired: true,
    requiresWritableAuthority: true,
  },
  localFirst: {
    requiresDurable: true,
    requiresDurableRequired: true,
    requiresWritableAuthority: true,
  },
  remoteBacked: {
    requiresDurable: true,
    requiresDurableRequired: true,
    requiresWritableAuthority: true,
  },
  readOnly: {
    requiresDurable: false,
    requiresDurableRequired: false,
    requiresWritableAuthority: false,
  },
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Validate a provider composition against the rules for its declared
 * durability mode and intent.
 *
 * Pure function — no side effects, no async, fully testable in isolation.
 */
export function validateComposition(
  config: DocumentStorageConfig,
  capabilitiesMap?: Map<string, StorageProviderCapabilities>,
): CompositionValidationResult {
  const violations: CompositionViolation[] = [];
  const warnings: CompositionViolation[] = [];
  const providers = config.providers;

  // -------------------------------------------------------------------------
  // 1. Kind–role compatibility
  // -------------------------------------------------------------------------
  for (const p of providers) {
    const traits = KIND_TRAITS[p.kind];
    if (!traits.supportedRoles.includes(p.role)) {
      violations.push({
        code: 'COMP_KIND_ROLE_MISMATCH',
        message:
          `Provider "${p.providerRefId}" (kind: ${p.kind}) cannot serve role "${p.role}". ` +
          `Supported roles: ${traits.supportedRoles.join(', ')}.`,
        severity: 'error',
        rule: 'kind-role-compatibility',
        involvedProviderRefIds: [p.providerRefId],
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. Exactly one writable authority
  // -------------------------------------------------------------------------
  const authorities = providers.filter((p) => p.role === 'authority');
  const writableAuthorities = authorities.filter((p) => KIND_TRAITS[p.kind].writable);

  if (config.durability !== 'readOnly' && config.durability !== 'ephemeral') {
    if (writableAuthorities.length === 0 && providers.length > 0) {
      violations.push({
        code: 'COMP_NO_WRITABLE_AUTHORITY',
        message:
          'No writable authority provider configured. ' +
          `Durability mode "${config.durability}" requires at least one writable authority.`,
        severity: 'error',
        rule: 'writable-authority-required',
      });
    } else if (writableAuthorities.length > 1) {
      warnings.push({
        code: 'COMP_MULTI_AUTHORITY',
        message:
          `Multiple writable authorities configured (${writableAuthorities.map((a) => a.providerRefId).join(', ')}). ` +
          'Multi-authority requires explicit conflict resolution — ensure this is intentional.',
        severity: 'warning',
        rule: 'single-authority',
        involvedProviderRefIds: writableAuthorities.map((a) => a.providerRefId),
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. Cache-only is invalid for remoteBacked
  // -------------------------------------------------------------------------
  if (config.durability === 'remoteBacked') {
    const nonCacheProviders = providers.filter(
      (p) => p.role !== 'cache' && p.role !== 'exportSink',
    );
    if (nonCacheProviders.length === 0 && providers.length > 0) {
      violations.push({
        code: 'COMP_CACHE_ONLY_REMOTE',
        message:
          'remoteBacked durability requires at least one non-cache, non-exportSink provider. ' +
          'Cache providers alone cannot satisfy remote durability requirements.',
        severity: 'error',
        rule: 'cache-only-remote-backed',
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. ExportSink providers don't satisfy durability
  // -------------------------------------------------------------------------
  const nonSinkProviders = providers.filter((p) => p.role !== 'exportSink');
  if (
    nonSinkProviders.length === 0 &&
    providers.length > 0 &&
    DURABILITY_RULES[config.durability].requiresDurable
  ) {
    violations.push({
      code: 'COMP_EXPORT_SINK_ONLY',
      message:
        'Export sink providers cannot satisfy durability requirements. ' +
        `Durability mode "${config.durability}" requires at least one non-exportSink durable provider.`,
      severity: 'error',
      rule: 'export-sink-durability',
    });
  }

  // -------------------------------------------------------------------------
  // 5. Snapshot providers force read-only unless paired with writable authority
  // -------------------------------------------------------------------------
  const snapshotOnlyProviders = providers.filter((p) => p.role === 'snapshot');
  if (
    snapshotOnlyProviders.length > 0 &&
    writableAuthorities.length === 0 &&
    config.durability !== 'readOnly' &&
    config.durability !== 'ephemeral'
  ) {
    if (config.allowReadOnlyFallback) {
      warnings.push({
        code: 'COMP_SNAPSHOT_READONLY_FALLBACK',
        message:
          'Snapshot-only providers present without a writable authority. ' +
          'Falling back to read-only mode.',
        severity: 'warning',
        rule: 'snapshot-readonly-fallback',
        involvedProviderRefIds: snapshotOnlyProviders.map((p) => p.providerRefId),
      });
    } else {
      violations.push({
        code: 'COMP_SNAPSHOT_NO_AUTHORITY',
        message:
          'Snapshot providers present without a writable authority and ' +
          'read-only fallback is disabled.',
        severity: 'error',
        rule: 'snapshot-needs-authority',
        involvedProviderRefIds: snapshotOnlyProviders.map((p) => p.providerRefId),
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. Durability mode requirements
  // -------------------------------------------------------------------------
  const durabilityRule = DURABILITY_RULES[config.durability];
  if (durabilityRule.requiresDurable) {
    const durableProviders = providers.filter((p) => KIND_TRAITS[p.kind].durable);
    if (durableProviders.length === 0 && providers.length > 0) {
      violations.push({
        code: 'COMP_NO_DURABLE_PROVIDER',
        message:
          `Durability mode "${config.durability}" requires at least one durable provider, ` +
          'but none are configured.',
        severity: 'error',
        rule: 'durability-requires-durable',
      });
    }

    if (durabilityRule.requiresDurableRequired) {
      const requiredDurableProviders = durableProviders.filter((p) => p.required);
      if (requiredDurableProviders.length === 0 && durableProviders.length > 0) {
        violations.push({
          code: 'COMP_NO_REQUIRED_DURABLE',
          message:
            `Durability mode "${config.durability}" requires at least one required (non-optional) ` +
            'durable provider, but all durable providers are optional.',
          severity: 'error',
          rule: 'required-durable-provider',
          involvedProviderRefIds: durableProviders.map((p) => p.providerRefId),
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 7. Contract version compatibility
  // -------------------------------------------------------------------------
  const contractVersions = new Set(providers.map((p) => p.contractVersion));
  if (contractVersions.size > 1) {
    warnings.push({
      code: 'COMP_VERSION_MISMATCH',
      message:
        `Multiple contract versions detected across providers: ${[...contractVersions].join(', ')}. ` +
        'Cross-version composition may cause compatibility issues.',
      severity: 'warning',
      rule: 'contract-version-compatibility',
    });
  }

  // -------------------------------------------------------------------------
  // Determine effective durability and read-only fallback
  // -------------------------------------------------------------------------
  const hasErrors = violations.some((v) => v.severity === 'error');
  let effectiveDurability = config.durability;
  let readOnlyFallbackApplied = false;

  if (hasErrors && config.allowReadOnlyFallback) {
    // Check if switching to readOnly resolves all violations
    const isSnapshotReadOnlyCase =
      snapshotOnlyProviders.length > 0 &&
      writableAuthorities.length === 0 &&
      violations.every(
        (v) => v.code === 'COMP_SNAPSHOT_NO_AUTHORITY' || v.code === 'COMP_NO_WRITABLE_AUTHORITY',
      );

    if (isSnapshotReadOnlyCase) {
      effectiveDurability = 'readOnly';
      readOnlyFallbackApplied = true;
      // Remove the violations that the fallback resolves
      const resolvedCodes = new Set(['COMP_SNAPSHOT_NO_AUTHORITY', 'COMP_NO_WRITABLE_AUTHORITY']);
      const unresolvedViolations = violations.filter((v) => !resolvedCodes.has(v.code));
      violations.length = 0;
      violations.push(...unresolvedViolations);
    }
  }

  const finalHasErrors = violations.some((v) => v.severity === 'error');

  return {
    valid: !finalHasErrors,
    violations: violations.filter((v) => v.severity === 'error'),
    warnings: [...warnings, ...violations.filter((v) => v.severity === 'warning')],
    effectiveDurability,
    readOnlyFallbackApplied,
  };
}

/**
 * Determine the ready mode from a validated composition and config.
 */
export function determineReadyMode(
  config: DocumentStorageConfig,
  compositionResult: CompositionValidationResult,
): 'readyReadWrite' | 'readyReadOnly' | 'readyEphemeral' {
  const durability = compositionResult.effectiveDurability;

  if (durability === 'readOnly' || compositionResult.readOnlyFallbackApplied) {
    return 'readyReadOnly';
  }
  if (durability === 'ephemeral') {
    return 'readyEphemeral';
  }
  return 'readyReadWrite';
}
