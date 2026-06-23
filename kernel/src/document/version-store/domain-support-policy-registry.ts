import {
  VERSION_DOMAIN_CAPABILITY_KEYS,
  VERSION_DOMAIN_POLICY_ID_PATTERN,
  type DomainCapabilityPolicyManifest,
  type VersionDomainPolicyRegistry,
} from '@mog-sdk/contracts/versioning';

import type { DomainSupportManifestDiagnostic } from './domain-support-manifest-validator';

const DOMAIN_POLICY_ID_RE = new RegExp(VERSION_DOMAIN_POLICY_ID_PATTERN);
const EVAL_ONLY_EXPECTED_FAILING_STATE = 'expected-failing';

export function validateDomainPolicyId(
  matrixRowId: string | undefined,
  domainId: string | undefined,
  domainPolicyId: unknown,
  diagnostics: DomainSupportManifestDiagnostic[],
): string | null {
  if (typeof domainPolicyId !== 'string' || domainPolicyId === '') {
    diagnostics.push({
      code: 'domain-policy-id-missing',
      message: 'Domain policy rows must provide domainPolicyId.',
      ...(typeof matrixRowId === 'string' && matrixRowId !== '' ? { matrixRowId } : {}),
      ...(typeof domainId === 'string' && domainId !== '' ? { domainId } : {}),
      policyField: 'domainPolicyId',
    });
    return null;
  }
  if (!DOMAIN_POLICY_ID_RE.test(domainPolicyId)) {
    diagnostics.push({
      code: 'domain-policy-id-malformed',
      message: `Domain policy id "${domainPolicyId}" is not public-safe.`,
      ...(typeof matrixRowId === 'string' && matrixRowId !== '' ? { matrixRowId } : {}),
      ...(typeof domainId === 'string' && domainId !== '' ? { domainId } : {}),
      policyField: 'domainPolicyId',
      policyValue: domainPolicyId,
    });
    return null;
  }
  return domainPolicyId;
}

export function policyRegistryRows(
  registry: VersionDomainPolicyRegistry | undefined,
  diagnostics: DomainSupportManifestDiagnostic[],
): ReadonlyMap<string, DomainCapabilityPolicyManifest> | null {
  if (!registry) return null;

  const rows = new Map<string, DomainCapabilityPolicyManifest>();
  for (const row of registry.domains) {
    const domainPolicyId = validateDomainPolicyId(
      row.matrixRowId,
      row.domainId,
      row.domainPolicyId,
      diagnostics,
    );
    if (!domainPolicyId) continue;
    if (rows.has(domainPolicyId)) {
      diagnostics.push({
        code: 'duplicate-domain-policy',
        message: `Public domain policy id "${domainPolicyId}" appears more than once in the registry.`,
        matrixRowId: row.matrixRowId,
        domainId: row.domainId,
        policyField: 'domainPolicyId',
        policyValue: domainPolicyId,
      });
      continue;
    }
    rows.set(domainPolicyId, row);
  }
  return rows;
}

export function validateRegistryMatch(
  domainPolicyId: string,
  manifestRow: Partial<DomainCapabilityPolicyManifest>,
  registryRows: ReadonlyMap<string, DomainCapabilityPolicyManifest> | null,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  if (!registryRows) return;
  const registryRow = registryRows.get(domainPolicyId);
  if (!registryRow) {
    diagnostics.push({
      code: 'unknown-domain-policy',
      message: `Domain policy id "${domainPolicyId}" is not present in the public policy registry.`,
      ...(typeof manifestRow.matrixRowId === 'string'
        ? { matrixRowId: manifestRow.matrixRowId }
        : {}),
      ...(typeof manifestRow.domainId === 'string' ? { domainId: manifestRow.domainId } : {}),
      policyField: 'domainPolicyId',
      policyValue: domainPolicyId,
    });
    return;
  }

  validateRegistryScalarField(
    'matrixRowId',
    manifestRow.matrixRowId,
    registryRow.matrixRowId,
    registryRow,
    diagnostics,
  );
  validateRegistryScalarField(
    'domainId',
    manifestRow.domainId,
    registryRow.domainId,
    registryRow,
    diagnostics,
  );
  validateRegistryScalarField(
    'domainClass',
    manifestRow.domainClass,
    registryRow.domainClass,
    registryRow,
    diagnostics,
  );
  validateRegistryScalarField(
    'capturePolicy',
    manifestRow.capturePolicy,
    registryRow.capturePolicy,
    registryRow,
    diagnostics,
  );
  validateRegistryScalarField(
    'writeAdmissionMode',
    manifestRow.writeAdmissionMode,
    registryRow.writeAdmissionMode,
    registryRow,
    diagnostics,
  );
  validateRegistryScalarField(
    'rolloutStage',
    manifestRow.rolloutStage,
    registryRow.rolloutStage,
    registryRow,
    diagnostics,
  );
  validateRegistryScalarField(
    'redactionPolicy',
    manifestRow.redactionPolicy,
    registryRow.redactionPolicy,
    registryRow,
    diagnostics,
  );
  validateRegistryHistoryAccess(manifestRow.historyAccess, registryRow, diagnostics);
  validateRegistryCapabilityStates(manifestRow.capabilityStates, registryRow, diagnostics);
}

function validateRegistryScalarField(
  field: string,
  actual: unknown,
  expected: string,
  registryRow: DomainCapabilityPolicyManifest,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  if (actual === expected) return;
  diagnostics.push({
    code: 'domain-policy-registry-mismatch',
    message: `Domain policy row "${registryRow.domainPolicyId}" field "${field}" does not match the public policy registry.`,
    matrixRowId: registryRow.matrixRowId,
    domainId: registryRow.domainId,
    policyField: field,
    ...registryMismatchPolicyValue(field, actual),
  });
}

function registryMismatchPolicyValue(
  field: string,
  actual: unknown,
): Pick<DomainSupportManifestDiagnostic, 'policyValue'> {
  if (typeof actual !== 'string') return {};
  if (field.startsWith('capabilityStates.') && actual === EVAL_ONLY_EXPECTED_FAILING_STATE) {
    return {};
  }
  return { policyValue: actual };
}

function validateRegistryHistoryAccess(
  actual: unknown,
  registryRow: DomainCapabilityPolicyManifest,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  if (!isPlainRecord(actual)) return;
  validateRegistryScalarField(
    'historyAccess.readMode',
    actual.readMode,
    registryRow.historyAccess.readMode,
    registryRow,
    diagnostics,
  );
  validateRegistryScalarField(
    'historyAccess.writeMode',
    actual.writeMode,
    registryRow.historyAccess.writeMode,
    registryRow,
    diagnostics,
  );
  validateRegistryScalarField(
    'historyAccess.redactionPolicy',
    actual.redactionPolicy,
    registryRow.historyAccess.redactionPolicy,
    registryRow,
    diagnostics,
  );
}

function validateRegistryCapabilityStates(
  actual: unknown,
  registryRow: DomainCapabilityPolicyManifest,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  if (!isPlainRecord(actual)) return;
  for (const capabilityKey of VERSION_DOMAIN_CAPABILITY_KEYS) {
    validateRegistryScalarField(
      `capabilityStates.${capabilityKey}`,
      actual[capabilityKey],
      registryRow.capabilityStates[capabilityKey],
      registryRow,
      diagnostics,
    );
  }
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
