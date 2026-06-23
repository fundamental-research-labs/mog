import type {
  VersionDomainCapabilityKey,
  VersionDomainCapabilityState,
  VersionDomainPolicyRegistry,
} from '@mog-sdk/contracts/versioning';

export type DomainSupportManifestDiagnosticCode =
  | 'schema-version-missing'
  | 'schema-version-unsupported'
  | 'manifest-malformed'
  | 'generated-at-missing'
  | 'generated-at-malformed'
  | 'manifest-stale'
  | 'domains-missing'
  | 'required-matrix-row-missing'
  | 'required-domain-missing'
  | 'domain-policy-id-missing'
  | 'domain-policy-id-malformed'
  | 'duplicate-domain-policy'
  | 'unknown-domain-policy'
  | 'domain-policy-registry-mismatch'
  | 'matrix-row-id-missing'
  | 'duplicate-matrix-row'
  | 'domain-malformed'
  | 'unknown-domain-class'
  | 'capture-policy-missing'
  | 'unknown-capture-policy'
  | 'write-admission-mode-missing'
  | 'unknown-write-admission-mode'
  | 'write-admission-mode-blocked'
  | 'rollout-stage-missing'
  | 'unknown-rollout-stage'
  | 'history-access-missing'
  | 'history-read-mode-missing'
  | 'unknown-history-read-mode'
  | 'history-write-mode-missing'
  | 'unknown-history-write-mode'
  | 'history-redaction-policy-missing'
  | 'unknown-history-redaction-policy'
  | 'redaction-policy-missing'
  | 'unknown-redaction-policy'
  | 'capability-states-missing'
  | 'capability-state-missing'
  | 'unknown-capability-key'
  | 'unknown-capability-state'
  | 'capability-state-blocked'
  | 'detector-row-missing';

export interface DomainSupportManifestDiagnostic {
  readonly code: DomainSupportManifestDiagnosticCode;
  readonly message: string;
  /** Subtype-capable matrix row the diagnostic applies to, when row-scoped. */
  readonly matrixRowId?: string;
  /** Domain the diagnostic applies to, when domain-scoped. */
  readonly domainId?: string;
  readonly capabilityKey?: VersionDomainCapabilityKey;
  readonly capabilityState?: VersionDomainCapabilityState;
  readonly policyField?: string;
  readonly policyValue?: string;
}

export interface DomainSupportManifestValidationOk {
  readonly ok: true;
  /** Matrix row ids that carry a present policy row, for caller convenience. */
  readonly presentMatrixRowIds: readonly string[];
  /** Domain ids that carry at least one present policy row, for caller convenience. */
  readonly presentDomainIds: readonly string[];
}

export interface DomainSupportManifestValidationFailure {
  readonly ok: false;
  readonly diagnostics: readonly DomainSupportManifestDiagnostic[];
}

export type DomainSupportManifestValidationResult =
  | DomainSupportManifestValidationOk
  | DomainSupportManifestValidationFailure;

/**
 * A detector row keyed by domain. Presence of a row asserts the manifest claims
 * the domain is present in the workbook; a present domain with no detector row
 * is a fail-closed condition (we cannot classify what the detector saw).
 *
 * This is a minimal additive shape used only by the validator. It is NOT a
 * shared public contract; it exists so the validator can express "a detector
 * row must exist for a present domain" without depending on the full
 * DomainPresenceDetector wiring that VC-06 owns.
 */
export interface DomainSupportDetectorRow {
  readonly matrixRowId?: string;
  readonly domainId: string;
  /** True when the detector observed the domain present in the workbook. */
  readonly present: boolean;
  /** The detector that produced this row. */
  readonly detectorId?: string;
}

export type DomainSupportManifestValidationOperation =
  | 'commit'
  | 'checkout'
  | 'merge'
  | 'applyMerge'
  | 'export';

export interface DomainSupportManifestValidationOptions {
  /**
   * Current time used for staleness comparison. Required for fail-closed
   * staleness checks; if omitted, staleness cannot be proven and is skipped,
   * but the caller should always supply it for durable operations.
   */
  readonly now?: Date;
  /**
   * Maximum age in milliseconds before a manifest is considered stale. When
   * provided together with `now`, a manifest whose `generatedAt` is older than
   * `now - maxAgeMs` fails closed.
   */
  readonly maxAgeMs?: number;
  /**
   * An explicit lower bound: manifests generated strictly before this instant
   * are stale regardless of `maxAgeMs` (e.g. an engine-upgrade / schema
   * checkpoint boundary). Fail-closed when violated.
   */
  readonly minGeneratedAt?: Date;
  /**
   * Override the required first-slice matrix row set. Defaults to
   * REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS. A manifest missing any required row
   * fails, even when another row exists for the same broad domainId.
   */
  readonly requiredMatrixRowIds?: readonly string[];
  /**
   * Optional broad-domain completeness check. Matrix rows are the primary
   * support key; use this only when a caller also needs a domain-family floor.
   */
  readonly requiredDomainIds?: readonly string[];
  /**
   * Detector rows observed for this workbook. When supplied, every domain whose
   * detector row is `present: true` must also have a matching policy row in the
   * manifest, otherwise the detector-row-missing fail-closed condition fires.
   */
  readonly detectorRows?: readonly DomainSupportDetectorRow[];
  /**
   * Public policy registry used as runtime authority. When supplied, every
   * manifest row must reference a known domainPolicyId and must match the
   * public policy row exactly for runtime-safe policy fields.
   */
  readonly domainPolicyRegistry?: VersionDomainPolicyRegistry;
  /**
   * Durable operation whose required capability states should be enforced.
   * Omit for shape-only validation.
   */
  readonly operation?: DomainSupportManifestValidationOperation;
  /**
   * Explicit capability keys to enforce. Overrides the default keys selected
   * from `operation` when supplied.
   */
  readonly requiredCapabilityKeys?: readonly VersionDomainCapabilityKey[];
  /**
   * Opaque-preserved domains require preservation/invalidation proof that this
   * validator does not model yet. Keep disabled for durable operations until a
   * caller supplies that proof.
   */
  readonly allowOpaquePreserved?: boolean;
}
