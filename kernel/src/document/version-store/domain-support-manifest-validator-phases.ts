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
} from '@mog-sdk/contracts/versioning';

import {
  REQUIRED_CAPABILITY_KEYS_BY_OPERATION,
  REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  SUPPORTED_DOMAIN_SUPPORT_MANIFEST_SCHEMA_VERSIONS,
} from './domain-support-manifest-validator-constants';
import {
  validateDomainPolicyId,
  validateRegistryMatch,
} from './domain-support-policy-registry';
import type {
  DomainSupportManifestDiagnostic,
  DomainSupportManifestDiagnosticCode,
  DomainSupportManifestValidationOptions,
} from './domain-support-manifest-validator-types';

const CLASS_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CLASSES);
const CAPABILITY_KEY_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CAPABILITY_KEYS);
const STATE_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CAPABILITY_STATES);
const CAPTURE_POLICY_SET: ReadonlySet<string> = new Set(CAPTURE_POLICIES);
const WRITE_ADMISSION_MODE_SET: ReadonlySet<string> = new Set(VERSION_WRITE_ADMISSION_MODES);
const ROLLOUT_STAGE_SET: ReadonlySet<string> = new Set(VERSION_ROLLOUT_STAGES);
const REDACTION_POLICY_SET: ReadonlySet<string> = new Set(VERSION_REDACTION_POLICIES);
const HISTORY_READ_MODE_SET: ReadonlySet<string> = new Set(VERSION_HISTORY_READ_MODES);
const HISTORY_WRITE_MODE_SET: ReadonlySet<string> = new Set(VERSION_HISTORY_WRITE_MODES);

export interface DomainRowsValidationContext {
  readonly requiredCapabilityKeys: readonly VersionDomainCapabilityKey[];
  readonly enforceDurableOperationPolicy: boolean;
  readonly registryRows: ReadonlyMap<string, DomainCapabilityPolicyManifest> | null;
}

export interface DomainRowsValidationResult {
  readonly presentMatrixRowIds: readonly string[];
  readonly presentDomainIds: ReadonlySet<string>;
}

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

export function requiredCapabilityKeysForOptions(
  options: DomainSupportManifestValidationOptions,
): readonly VersionDomainCapabilityKey[] {
  if (options.requiredCapabilityKeys) return options.requiredCapabilityKeys;
  if (options.operation) return REQUIRED_CAPABILITY_KEYS_BY_OPERATION[options.operation];
  return [];
}

export function validateManifestMetadata(
  candidate: Partial<DomainSupportManifest>,
  options: DomainSupportManifestValidationOptions,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
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
}

export function validateManifestDomainRows(
  domains: unknown,
  options: DomainSupportManifestValidationOptions,
  context: DomainRowsValidationContext,
  diagnostics: DomainSupportManifestDiagnostic[],
): DomainRowsValidationResult {
  const presentMatrixRowIds: string[] = [];
  const presentDomainIds = new Set<string>();
  if (!Array.isArray(domains)) {
    diagnostics.push({
      code: 'domains-missing',
      message: 'Manifest domains must be an array.',
    });
    return { presentMatrixRowIds, presentDomainIds };
  }

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
      validateRegistryMatch(domainPolicyId, typed, context.registryRows, diagnostics);
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
      context.enforceDurableOperationPolicy,
      diagnostics,
    );
    validateCapabilityStates(matrixRowId, domainId, typed.capabilityStates, diagnostics);
    if (isVersionDomainClass(domainClass)) {
      validateRequiredCapabilityState(
        matrixRowId,
        domainId,
        domainClass,
        typed.capabilityStates,
        context.requiredCapabilityKeys,
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
        message: `Matrix row "${matrixRowId}" for domain "${domainId}" references an unknown legacy capabilityState.`,
        matrixRowId,
        domainId,
        policyField: 'capabilityState',
      });
    }
  }

  validateRequiredCoverage(seenMatrixRows, seenDomains, options, diagnostics);
  validateDetectorCoverage(seenMatrixRows, seenDomains, options, diagnostics);

  return { presentMatrixRowIds, presentDomainIds };
}

function validateRequiredCoverage(
  seenMatrixRows: ReadonlySet<string>,
  seenDomains: ReadonlySet<string>,
  options: DomainSupportManifestValidationOptions,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  // --- required first-slice matrix row coverage ---------------------------
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
}

function validateDetectorCoverage(
  seenMatrixRows: ReadonlySet<string>,
  seenDomains: ReadonlySet<string>,
  options: DomainSupportManifestValidationOptions,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  // --- detector row coverage: a present matrix row needs policy -----------
  if (!options.detectorRows) return;

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
        message: `Matrix row "${matrixRowId}" for domain "${domainId}" capability "${key}" references an unknown state.`,
        matrixRowId,
        domainId,
        capabilityKey: key,
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
