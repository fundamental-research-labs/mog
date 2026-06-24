import type { VersionStoreDiagnostic, WorkbookCommitId } from '@mog-sdk/contracts/api';

import {
  ACCEPT_RESOLUTION_POLICIES,
  AUTHOR_KINDS,
  AUTHOR_TRUST_LEVELS,
  PROPOSAL_ID_RE,
  PROPOSAL_STATUSES,
  WORKBOOK_COMMIT_ID_RE,
} from './version-proposal-validation-constants';
import {
  invalidOptionDiagnostic,
  invalidProposalIdDiagnostic,
  unauthorizedAuthorDiagnostic,
} from './version-proposal-validation-diagnostics';
import type {
  AcceptAgentProposalInput,
  AgentProposalStatus,
  VersionProposalPublicOperation,
} from './version-proposal-types';

export function isPlainInput(
  input: unknown,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): input is Readonly<Record<string, unknown>> {
  if (isRecord(input) && !Array.isArray(input)) return true;
  diagnostics.push(
    invalidOptionDiagnostic(operation, 'input', 'proposal input must be an object.'),
  );
  return false;
}

export function validateKnownKeys(
  input: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(input)) {
    if (allowedKeys.has(key)) continue;
    diagnostics.push(invalidOptionDiagnostic(operation, key, `Unknown proposal option "${key}".`));
  }
}

export function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  const value = input[key];
  if (typeof value === 'string' && value.length > 0) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a non-empty string.`));
}

export function validateRequiredProposalId(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  validateProposalId(input[key], operation, key, diagnostics);
}

export function validateOptionalProposalId(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  validateProposalId(input[key], operation, key, diagnostics);
}

function validateProposalId(
  value: unknown,
  operation: VersionProposalPublicOperation,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a non-empty string.`));
    return false;
  }
  if (PROPOSAL_ID_RE.test(value)) return true;
  diagnostics.push(invalidProposalIdDiagnostic(operation, key));
  return false;
}

export function validateOptionalString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || typeof input[key] === 'string') return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a string.`));
}

export function validateRequiredRecord(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (isRecord(input[key]) && !Array.isArray(input[key])) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be an object.`));
}

export function validateTrustedAuthor(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
  requiredKind?: string,
): void {
  const value = input[key];
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be an object.`));
    return;
  }
  if (!AUTHOR_KINDS.has(value.kind as string)) {
    diagnostics.push(
      invalidOptionDiagnostic(operation, `${key}.kind`, `${key}.kind is not supported.`),
    );
  }
  if (requiredKind && value.kind !== requiredKind) {
    diagnostics.push(invalidOptionDiagnostic(operation, `${key}.kind`, `${key}.kind is invalid.`));
  }
  if (!AUTHOR_TRUST_LEVELS.has(value.trust as string)) {
    diagnostics.push(
      invalidOptionDiagnostic(operation, `${key}.trust`, `${key}.trust is not supported.`),
    );
    return;
  }
  if (value.trust !== 'trusted') diagnostics.push(unauthorizedAuthorDiagnostic(operation, key));
  validateOptionalAuthorString(value, 'displayName', key, operation, diagnostics);
  validateOptionalAuthorString(value, 'principalId', key, operation, diagnostics);
  validateOptionalAuthorString(value, 'agentRunId', key, operation, diagnostics);
}

function validateOptionalAuthorString(
  author: Readonly<Record<string, unknown>>,
  field: string,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(field in author) || typeof author[field] === 'string') return;
  diagnostics.push(
    invalidOptionDiagnostic(operation, `${key}.${field}`, `${key}.${field} must be a string.`),
  );
}

export function validateOptionalRecord(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || (isRecord(input[key]) && !Array.isArray(input[key]))) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be an object.`));
}

export function validateRequiredArray(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (Array.isArray(input[key])) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be an array.`));
}

export function validateOptionalProposalStatus(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || PROPOSAL_STATUSES.has(input[key] as AgentProposalStatus)) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a proposal status.`));
}

export function validateRequiredResolutionPolicy(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (ACCEPT_RESOLUTION_POLICIES.has(input[key] as AcceptAgentProposalInput['resolutionPolicy'])) {
    return;
  }
  diagnostics.push(
    invalidOptionDiagnostic(operation, key, `${key} must be a proposal accept policy.`),
  );
}

export function validateOptionalCommitId(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  validateCommitId(input[key], operation, key, diagnostics);
}

export function validateOptionalRecordRevision(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  const value = input[key];
  if (
    isRecord(value) &&
    typeof value.value === 'string' &&
    ((value.kind === 'counter' && /^(0|[1-9][0-9]*)$/.test(value.value)) ||
      (value.kind === 'opaque' && value.value.length > 0))
  ) {
    return;
  }
  diagnostics.push(
    invalidOptionDiagnostic(operation, key, `${key} must be a version record revision.`),
  );
}

export function validateRequiredCommitId(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  validateCommitId(input[key], operation, key, diagnostics);
}

function validateCommitId(
  value: unknown,
  operation: VersionProposalPublicOperation,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
): value is WorkbookCommitId {
  if (typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)) return true;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a commit id.`));
  return false;
}

export function validateRequiredRevision(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (Number.isInteger(input[key]) && Number(input[key]) >= 1) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a positive integer.`));
}

export function validateOptionalLimit(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  const value = input[key];
  if (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100) return;
  diagnostics.push(
    invalidOptionDiagnostic(operation, key, `${key} must be an integer from 1 to 100.`),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
