import {
  CAPTURE_POLICIES,
  VERSION_HISTORY_READ_MODES,
  VERSION_HISTORY_WRITE_MODES,
  VERSION_REDACTION_POLICIES,
  VERSION_ROLLOUT_STAGES,
  VERSION_WRITE_ADMISSION_MODES,
  type DomainCapabilityPolicyManifest,
} from '@mog-sdk/contracts/versioning';

import type {
  DomainSupportManifestDiagnostic,
  DomainSupportManifestDiagnosticCode,
} from './domain-support-manifest-validator-types';
import { isPlainRecord } from './domain-support-manifest-validator-phases-guards';

const CAPTURE_POLICY_SET: ReadonlySet<string> = new Set(CAPTURE_POLICIES);
const WRITE_ADMISSION_MODE_SET: ReadonlySet<string> = new Set(VERSION_WRITE_ADMISSION_MODES);
const ROLLOUT_STAGE_SET: ReadonlySet<string> = new Set(VERSION_ROLLOUT_STAGES);
const REDACTION_POLICY_SET: ReadonlySet<string> = new Set(VERSION_REDACTION_POLICIES);
const HISTORY_READ_MODE_SET: ReadonlySet<string> = new Set(VERSION_HISTORY_READ_MODES);
const HISTORY_WRITE_MODE_SET: ReadonlySet<string> = new Set(VERSION_HISTORY_WRITE_MODES);

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

export function validatePolicyFields(
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
