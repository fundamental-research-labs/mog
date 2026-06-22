// VC-06A: Fail-closed validator for the DomainSupportManifest.
//
// Durable version-control operations (commit/checkout/merge/import) must NOT
// proceed on a manifest that is missing, stale, or structurally incomplete. The
// validator encodes that as a pure function whose defaults are fail-closed: any
// missing/unknown/stale input produces `{ ok: false, diagnostics }` rather than
// silently degrading. Callers gate durable writes on `ok === true`.
//
// This module is intentionally self-contained and not wired into the live write
// path; VC-06 / VC-04 own that integration. It exists so the fail-closed
// contract can be specified and tested ahead of Batch B promotion.

import {
  CAPTURE_POLICIES,
  VERSION_DOMAIN_CAPABILITY_KEYS,
  VERSION_DOMAIN_CAPABILITY_STATES,
  VERSION_DOMAIN_CLASSES,
  VERSION_HISTORY_READ_MODES,
  VERSION_HISTORY_WRITE_MODES,
  VERSION_REDACTION_POLICIES,
  VERSION_ROLLOUT_STAGES,
  VERSION_WRITE_ADMISSION_MODES,
  type DomainCapabilityPolicyManifest,
  type DomainSupportManifest,
  type VersionDomainCapabilityKey,
  type VersionDomainCapabilityState,
  type VersionDomainClass,
  type VersionDomainPolicyRegistry,
} from '@mog-sdk/contracts/versioning';
import {
  policyRegistryRows,
  validateDomainPolicyId,
  validateRegistryMatch,
} from './domain-support-policy-registry';

/**
 * Schema versions this validator understands. A manifest tagged with anything
 * outside this set is rejected (fail-closed) rather than best-effort parsed.
 */
export const SUPPORTED_DOMAIN_SUPPORT_MANIFEST_SCHEMA_VERSIONS = Object.freeze([
  '2',
  'domain-support-manifest.v2',
] as const);

/**
 * First-slice domains that MUST be present in every manifest before a durable
 * operation can proceed. A manifest that omits any of these fails closed: we
 * cannot prove coverage for a domain we have no row for. Kept in sync with the
 * coverage matrix / BatchBDomainInventory first-slice set.
 */
export const REQUIRED_FIRST_SLICE_DOMAIN_IDS = Object.freeze([
  'workbook-metadata',
  'sheets',
  'rows-columns',
  'cells.values',
  'cells.formulas',
  'recalc-caches',
] as const);

/**
 * Support policy rows are keyed by matrix row, not by broad domain family. The
 * current first slice happens to use row ids equal to domain ids, but subtype
 * rows such as cells.formats.direct must be represented independently.
 */
export const REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS = Object.freeze([
  'workbook-metadata',
  'sheets',
  'rows-columns',
  'cells.values',
  'cells.formulas',
  'recalc-caches',
] as const);

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

export type DomainSupportManifestValidationOperation =
  | 'commit'
  | 'checkout'
  | 'merge'
  | 'applyMerge';

export const REQUIRED_CAPABILITY_KEYS_BY_OPERATION = Object.freeze({
  commit: ['capture', 'persistence'],
  checkout: ['checkout'],
  merge: ['merge'],
  applyMerge: ['merge', 'persistence'],
} satisfies Readonly<
  Record<DomainSupportManifestValidationOperation, readonly VersionDomainCapabilityKey[]>
>);

const CLASS_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CLASSES);
const CAPABILITY_KEY_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CAPABILITY_KEYS);
const STATE_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CAPABILITY_STATES);
const CAPTURE_POLICY_SET: ReadonlySet<string> = new Set(CAPTURE_POLICIES);
const WRITE_ADMISSION_MODE_SET: ReadonlySet<string> = new Set(VERSION_WRITE_ADMISSION_MODES);
const ROLLOUT_STAGE_SET: ReadonlySet<string> = new Set(VERSION_ROLLOUT_STAGES);
const REDACTION_POLICY_SET: ReadonlySet<string> = new Set(VERSION_REDACTION_POLICIES);
const HISTORY_READ_MODE_SET: ReadonlySet<string> = new Set(VERSION_HISTORY_READ_MODES);
const HISTORY_WRITE_MODE_SET: ReadonlySet<string> = new Set(VERSION_HISTORY_WRITE_MODES);

function isVersionDomainClass(value: unknown): value is VersionDomainClass {
  return typeof value === 'string' && CLASS_SET.has(value);
}

function isVersionDomainCapabilityState(value: unknown): value is VersionDomainCapabilityState {
  return typeof value === 'string' && STATE_SET.has(value);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSupportedSchemaVersion(value: string): boolean {
  return (SUPPORTED_DOMAIN_SUPPORT_MANIFEST_SCHEMA_VERSIONS as readonly string[]).includes(value);
}

function validateCapabilityStates(
  matrixRowId: string,
  domainId: string,
  capabilityStates: unknown,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  if (!isPlainRecord(capabilityStates)) {
    diagnostics.push({
      code: 'capability-states-missing',
      message: `Matrix row "${matrixRowId}" for domain "${domainId}" must provide capabilityStates keyed by version capability.`,
      matrixRowId,
      domainId,
    });
    return;
  }

  for (const key of Object.keys(capabilityStates)) {
    if (!CAPABILITY_KEY_SET.has(key)) {
      diagnostics.push({
        code: 'unknown-capability-key',
        message: `Matrix row "${matrixRowId}" for domain "${domainId}" references unknown capability key "${key}".`,
        matrixRowId,
        domainId,
      });
    }
  }

  for (const key of VERSION_DOMAIN_CAPABILITY_KEYS) {
    const state = capabilityStates[key];
    if (state === undefined) {
      diagnostics.push({
        code: 'capability-state-missing',
        message: `Matrix row "${matrixRowId}" for domain "${domainId}" is missing capability state for "${key}".`,
        matrixRowId,
        domainId,
      });
      continue;
    }
    if (!isVersionDomainCapabilityState(state)) {
      diagnostics.push({
        code: 'unknown-capability-state',
        message: `Matrix row "${matrixRowId}" for domain "${domainId}" capability "${key}" references unknown state "${String(state)}".`,
        matrixRowId,
        domainId,
      });
    }
  }
}

function validatePolicyStringField(
  matrixRowId: string,
  domainId: string,
  field: string,
  value: unknown,
  allowedValues: ReadonlySet<string>,
  missingCode: DomainSupportManifestDiagnosticCode,
  unknownCode: DomainSupportManifestDiagnosticCode,
  diagnostics: DomainSupportManifestDiagnostic[],
): string | null {
  if (typeof value !== 'string' || value === '') {
    diagnostics.push({
      code: missingCode,
      message: `Matrix row "${matrixRowId}" for domain "${domainId}" must provide policy field "${field}".`,
      matrixRowId,
      domainId,
      policyField: field,
    });
    return null;
  }
  if (!allowedValues.has(value)) {
    diagnostics.push({
      code: unknownCode,
      message: `Matrix row "${matrixRowId}" for domain "${domainId}" policy field "${field}" references unknown value "${value}".`,
      matrixRowId,
      domainId,
      policyField: field,
      policyValue: value,
    });
    return null;
  }
  return value;
}

function validateHistoryAccessPolicy(
  matrixRowId: string,
  domainId: string,
  historyAccess: unknown,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  if (!isPlainRecord(historyAccess)) {
    diagnostics.push({
      code: 'history-access-missing',
      message: `Matrix row "${matrixRowId}" for domain "${domainId}" must provide historyAccess policy.`,
      matrixRowId,
      domainId,
      policyField: 'historyAccess',
    });
    return;
  }

  validatePolicyStringField(
    matrixRowId,
    domainId,
    'historyAccess.readMode',
    historyAccess.readMode,
    HISTORY_READ_MODE_SET,
    'history-read-mode-missing',
    'unknown-history-read-mode',
    diagnostics,
  );
  validatePolicyStringField(
    matrixRowId,
    domainId,
    'historyAccess.writeMode',
    historyAccess.writeMode,
    HISTORY_WRITE_MODE_SET,
    'history-write-mode-missing',
    'unknown-history-write-mode',
    diagnostics,
  );
  validatePolicyStringField(
    matrixRowId,
    domainId,
    'historyAccess.redactionPolicy',
    historyAccess.redactionPolicy,
    REDACTION_POLICY_SET,
    'history-redaction-policy-missing',
    'unknown-history-redaction-policy',
    diagnostics,
  );
}

function validatePolicyFields(
  matrixRowId: string,
  domainId: string,
  row: Partial<DomainCapabilityPolicyManifest>,
  enforceDurableOperationPolicy: boolean,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  validatePolicyStringField(
    matrixRowId,
    domainId,
    'capturePolicy',
    row.capturePolicy,
    CAPTURE_POLICY_SET,
    'capture-policy-missing',
    'unknown-capture-policy',
    diagnostics,
  );
  const writeAdmissionMode = validatePolicyStringField(
    matrixRowId,
    domainId,
    'writeAdmissionMode',
    row.writeAdmissionMode,
    WRITE_ADMISSION_MODE_SET,
    'write-admission-mode-missing',
    'unknown-write-admission-mode',
    diagnostics,
  );
  if (enforceDurableOperationPolicy && writeAdmissionMode === 'block') {
    diagnostics.push({
      code: 'write-admission-mode-blocked',
      message: `Matrix row "${matrixRowId}" for domain "${domainId}" has writeAdmissionMode "block", which is not allowed for this durable operation.`,
      matrixRowId,
      domainId,
      policyField: 'writeAdmissionMode',
      policyValue: writeAdmissionMode,
    });
  }
  validatePolicyStringField(
    matrixRowId,
    domainId,
    'rolloutStage',
    row.rolloutStage,
    ROLLOUT_STAGE_SET,
    'rollout-stage-missing',
    'unknown-rollout-stage',
    diagnostics,
  );
  validateHistoryAccessPolicy(matrixRowId, domainId, row.historyAccess, diagnostics);
  validatePolicyStringField(
    matrixRowId,
    domainId,
    'redactionPolicy',
    row.redactionPolicy,
    REDACTION_POLICY_SET,
    'redaction-policy-missing',
    'unknown-redaction-policy',
    diagnostics,
  );
}

function requiredCapabilityKeysForOptions(
  options: DomainSupportManifestValidationOptions,
): readonly VersionDomainCapabilityKey[] {
  if (options.requiredCapabilityKeys) return options.requiredCapabilityKeys;
  if (options.operation) return REQUIRED_CAPABILITY_KEYS_BY_OPERATION[options.operation];
  return [];
}

function validateRequiredCapabilityState(
  matrixRowId: string,
  domainId: string,
  domainClass: VersionDomainClass,
  capabilityStates: unknown,
  requiredCapabilityKeys: readonly VersionDomainCapabilityKey[],
  allowOpaquePreserved: boolean,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  if (requiredCapabilityKeys.length === 0 || !isPlainRecord(capabilityStates)) return;

  for (const capabilityKey of requiredCapabilityKeys) {
    const state = capabilityStates[capabilityKey];
    if (!isVersionDomainCapabilityState(state)) continue;
    if (isCapabilityStateAllowedForOperation(domainClass, state, allowOpaquePreserved)) continue;

    diagnostics.push({
      code: 'capability-state-blocked',
      message: `Matrix row "${matrixRowId}" for domain "${domainId}" has state "${state}" for capability "${capabilityKey}", which is not allowed for this durable operation.`,
      matrixRowId,
      domainId,
      capabilityKey,
      capabilityState: state,
    });
  }
}

function isCapabilityStateAllowedForOperation(
  domainClass: VersionDomainClass,
  state: VersionDomainCapabilityState,
  allowOpaquePreserved: boolean,
): boolean {
  switch (state) {
    case 'supported':
      return true;
    case 'derived':
      return domainClass === 'derived';
    case 'excluded':
      return domainClass === 'transient';
    case 'opaque-preserved':
      return allowOpaquePreserved;
    case 'not-started':
    case 'contracted':
    case 'opaque-blocking':
      return false;
  }
}

/**
 * Pure, fail-closed validation of a DomainSupportManifest.
 *
 * Returns `{ ok: true }` only for a well-formed, fresh, complete manifest.
 * Otherwise returns `{ ok: false, diagnostics }`. The function never throws on
 * a structurally invalid manifest — malformed input is reported as a
 * diagnostic — so callers can treat any non-`ok` result as a hard block.
 */
export function validateDomainSupportManifest(
  manifest: DomainSupportManifest | unknown,
  options: DomainSupportManifestValidationOptions = {},
): DomainSupportManifestValidationResult {
  const diagnostics: DomainSupportManifestDiagnostic[] = [];
  const requiredCapabilityKeys = requiredCapabilityKeysForOptions(options);
  const enforceDurableOperationPolicy =
    options.operation !== undefined || requiredCapabilityKeys.length > 0;
  const registryRows = policyRegistryRows(options.domainPolicyRegistry, diagnostics);

  // --- structural shape ---------------------------------------------------
  if (manifest === null || typeof manifest !== 'object') {
    return {
      ok: false,
      diagnostics: [{ code: 'manifest-malformed', message: 'Manifest is not an object.' }],
    };
  }

  const candidate = manifest as Partial<DomainSupportManifest>;

  // --- schema version (fail-closed on missing/unsupported) ----------------
  const schemaVersion = candidate.schemaVersion;
  if (schemaVersion === undefined || schemaVersion === null || schemaVersion === '') {
    diagnostics.push({
      code: 'schema-version-missing',
      message: 'Manifest schemaVersion is missing.',
    });
  } else if (typeof schemaVersion !== 'string' || !isSupportedSchemaVersion(schemaVersion)) {
    diagnostics.push({
      code: 'schema-version-unsupported',
      message: `Manifest schemaVersion "${String(schemaVersion)}" is not supported. Supported: ${SUPPORTED_DOMAIN_SUPPORT_MANIFEST_SCHEMA_VERSIONS.join(', ')}.`,
    });
  }

  // --- freshness (fail-closed on missing/malformed/stale) -----------------
  const generatedAtRaw = candidate.generatedAt;
  let generatedAt: number | undefined;
  if (generatedAtRaw === undefined || generatedAtRaw === null || generatedAtRaw === '') {
    diagnostics.push({
      code: 'generated-at-missing',
      message: 'Manifest generatedAt is missing.',
    });
  } else if (typeof generatedAtRaw !== 'string') {
    diagnostics.push({
      code: 'generated-at-malformed',
      message: 'Manifest generatedAt must be an ISO-8601 string.',
    });
  } else {
    const parsed = Date.parse(generatedAtRaw);
    if (Number.isNaN(parsed)) {
      diagnostics.push({
        code: 'generated-at-malformed',
        message: `Manifest generatedAt "${generatedAtRaw}" is not a valid date.`,
      });
    } else {
      generatedAt = parsed;
    }
  }

  if (generatedAt !== undefined) {
    if (options.minGeneratedAt instanceof Date && generatedAt < options.minGeneratedAt.getTime()) {
      diagnostics.push({
        code: 'manifest-stale',
        message: `Manifest generatedAt is older than the required lower bound ${options.minGeneratedAt.toISOString()}.`,
      });
    }
    if (
      options.now instanceof Date &&
      typeof options.maxAgeMs === 'number' &&
      Number.isFinite(options.maxAgeMs)
    ) {
      const ageMs = options.now.getTime() - generatedAt;
      if (ageMs > options.maxAgeMs) {
        diagnostics.push({
          code: 'manifest-stale',
          message: `Manifest is ${ageMs}ms old, exceeding the maximum allowed age of ${options.maxAgeMs}ms.`,
        });
      }
    }
  }

  // --- domain rows --------------------------------------------------------
  const domains = candidate.domains;
  const presentMatrixRowIds: string[] = [];
  const presentDomainIds = new Set<string>();
  if (!Array.isArray(domains)) {
    diagnostics.push({
      code: 'domains-missing',
      message: 'Manifest domains must be an array.',
    });
  } else {
    const seenMatrixRows = new Set<string>();
    const seenDomainPolicies = new Set<string>();
    const seenDomains = new Set<string>();
    for (let index = 0; index < domains.length; index += 1) {
      const row = domains[index] as Partial<DomainCapabilityPolicyManifest> | unknown;
      if (row === null || typeof row !== 'object') {
        diagnostics.push({
          code: 'domain-malformed',
          message: `Domain row at index ${index} is not an object.`,
        });
        continue;
      }
      const typed = row as Partial<DomainCapabilityPolicyManifest>;
      const domainPolicyId = validateDomainPolicyId(
        typed.matrixRowId,
        typed.domainId,
        typed.domainPolicyId,
        diagnostics,
      );
      if (domainPolicyId) {
        if (seenDomainPolicies.has(domainPolicyId)) {
          diagnostics.push({
            code: 'duplicate-domain-policy',
            message: `Domain policy id "${domainPolicyId}" appears more than once.`,
            ...(typeof typed.matrixRowId === 'string' && typed.matrixRowId !== ''
              ? { matrixRowId: typed.matrixRowId }
              : {}),
            ...(typeof typed.domainId === 'string' && typed.domainId !== ''
              ? { domainId: typed.domainId }
              : {}),
            policyField: 'domainPolicyId',
            policyValue: domainPolicyId,
          });
        } else {
          seenDomainPolicies.add(domainPolicyId);
        }
        validateRegistryMatch(domainPolicyId, typed, registryRows, diagnostics);
      }
      const matrixRowId = typed.matrixRowId;
      const domainId = typed.domainId;
      if (typeof matrixRowId !== 'string' || matrixRowId === '') {
        diagnostics.push({
          code: 'matrix-row-id-missing',
          message: `Domain row at index ${index} has a missing or empty matrixRowId.`,
          ...(typeof domainId === 'string' && domainId !== '' ? { domainId } : {}),
        });
        continue;
      }
      if (typeof domainId !== 'string' || domainId === '') {
        diagnostics.push({
          code: 'domain-malformed',
          message: `Domain row at index ${index} has a missing or empty domainId.`,
          matrixRowId,
        });
        continue;
      }
      if (seenMatrixRows.has(matrixRowId)) {
        diagnostics.push({
          code: 'duplicate-matrix-row',
          message: `Matrix row "${matrixRowId}" appears more than once.`,
          matrixRowId,
          domainId,
        });
        continue;
      }
      seenMatrixRows.add(matrixRowId);
      seenDomains.add(domainId);
      presentMatrixRowIds.push(matrixRowId);
      presentDomainIds.add(domainId);

      const domainClass = typed.domainClass;
      if (!isVersionDomainClass(domainClass)) {
        diagnostics.push({
          code: 'unknown-domain-class',
          message: `Matrix row "${matrixRowId}" for domain "${domainId}" references unknown domainClass "${String(typed.domainClass)}".`,
          matrixRowId,
          domainId,
        });
      }
      validatePolicyFields(
        matrixRowId,
        domainId,
        typed,
        enforceDurableOperationPolicy,
        diagnostics,
      );
      validateCapabilityStates(matrixRowId, domainId, typed.capabilityStates, diagnostics);
      if (isVersionDomainClass(domainClass)) {
        validateRequiredCapabilityState(
          matrixRowId,
          domainId,
          domainClass,
          typed.capabilityStates,
          requiredCapabilityKeys,
          options.allowOpaquePreserved === true,
          diagnostics,
        );
      }
      if (
        typed.capabilityState !== undefined &&
        !isVersionDomainCapabilityState(typed.capabilityState)
      ) {
        diagnostics.push({
          code: 'unknown-capability-state',
          message: `Matrix row "${matrixRowId}" for domain "${domainId}" references unknown legacy capabilityState "${String(typed.capabilityState)}".`,
          matrixRowId,
          domainId,
        });
      }
    }

    // --- required first-slice matrix row coverage -------------------------
    const requiredMatrixRows = options.requiredMatrixRowIds ?? REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS;
    for (const matrixRowId of requiredMatrixRows) {
      if (!seenMatrixRows.has(matrixRowId)) {
        diagnostics.push({
          code: 'required-matrix-row-missing',
          message: `Required first-slice matrix row "${matrixRowId}" is absent from the manifest.`,
          matrixRowId,
        });
      }
    }

    if (options.requiredDomainIds) {
      for (const requiredId of options.requiredDomainIds) {
        if (!seenDomains.has(requiredId)) {
          diagnostics.push({
            code: 'required-domain-missing',
            message: `Required domain "${requiredId}" is absent from the manifest.`,
            domainId: requiredId,
          });
        }
      }
    }

    // --- detector row coverage: a present matrix row needs policy ---------
    if (options.detectorRows) {
      for (const detector of options.detectorRows) {
        if (!detector.present) continue;

        if (detector.matrixRowId) {
          if (seenMatrixRows.has(detector.matrixRowId)) continue;
          diagnostics.push({
            code: 'detector-row-missing',
            message: `Matrix row "${detector.matrixRowId}" was detected present but has no policy row in the manifest.`,
            matrixRowId: detector.matrixRowId,
            domainId: detector.domainId,
          });
          continue;
        }

        if (!seenDomains.has(detector.domainId)) {
          diagnostics.push({
            code: 'detector-row-missing',
            message: `Domain "${detector.domainId}" was detected present but has no policy row in the manifest.`,
            domainId: detector.domainId,
          });
        }
      }
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, presentMatrixRowIds, presentDomainIds: [...presentDomainIds] };
}

/**
 * Typed error for callers that prefer throw-based control flow. Carries the
 * structured diagnostics so the boundary can still log/redact them.
 */
export class DomainSupportManifestError extends Error {
  readonly diagnostics: readonly DomainSupportManifestDiagnostic[];

  constructor(diagnostics: readonly DomainSupportManifestDiagnostic[]) {
    const codes = diagnostics.map((d) => d.code).join(', ');
    super(`DomainSupportManifest failed validation (fail-closed): ${codes}`);
    this.name = 'DomainSupportManifestError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Fail-closed assertion wrapper. Returns the validated manifest's present
 * domain ids on success, throws DomainSupportManifestError otherwise. Use this
 * at a durable-operation boundary that must not proceed on a bad manifest.
 */
export function assertDomainSupportManifest(
  manifest: DomainSupportManifest | unknown,
  options: DomainSupportManifestValidationOptions = {},
): readonly string[] {
  const result = validateDomainSupportManifest(manifest, options);
  if (!result.ok) {
    throw new DomainSupportManifestError(result.diagnostics);
  }
  return result.presentMatrixRowIds;
}
