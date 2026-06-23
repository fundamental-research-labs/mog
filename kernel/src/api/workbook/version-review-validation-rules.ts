import type {
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookVersionReviewStatus,
} from '@mog-sdk/contracts/api';

import type { VersionReviewPublicOperation } from './version-review-operation';
import { invalidOptionDiagnostic } from './version-review-results';
import {
  REVIEW_STATUSES,
  USER_MUTABLE_REVIEW_STATUSES,
  WORKBOOK_COMMIT_ID_RE,
} from './version-review-validation-constants';

export function isPlainInput(
  input: unknown,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): input is Readonly<Record<string, unknown>> {
  if (isRecord(input) && !Array.isArray(input)) return true;
  diagnostics.push(invalidOptionDiagnostic(operation, 'input', 'review input must be an object.'));
  return false;
}

export function validateKnownKeys(
  input: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(input)) {
    if (allowedKeys.has(key)) continue;
    diagnostics.push(invalidOptionDiagnostic(operation, key, `Unknown review option "${key}".`));
  }
}

export function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  const value = input[key];
  if (typeof value === 'string' && value.length > 0) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a non-empty string.`));
}

export function validateOptionalString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || typeof input[key] === 'string') return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a string.`));
}

export function validateRequiredRecord(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (isRecord(input[key]) && !Array.isArray(input[key])) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be an object.`));
}

export function validateOptionalReviewStatus(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || REVIEW_STATUSES.has(input[key] as WorkbookVersionReviewStatus)) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a review status.`));
}

export function validateRequiredReviewStatus(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (REVIEW_STATUSES.has(input[key] as WorkbookVersionReviewStatus)) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a review status.`));
}

export function validateRequiredUserMutableReviewStatus(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (USER_MUTABLE_REVIEW_STATUSES.has(input[key] as WorkbookVersionReviewStatus)) return;
  diagnostics.push(
    invalidOptionDiagnostic(operation, key, `${key} must be a user-mutable review status.`),
  );
}

export function validateOptionalCommitId(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  validateCommitId(input[key], operation, key, diagnostics);
}

export function validateCommitId(
  value: unknown,
  operation: VersionReviewPublicOperation,
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
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (Number.isInteger(input[key]) && Number(input[key]) >= 1) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a positive integer.`));
}

export function validateOptionalLimit(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  const value = input[key];
  if (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100) return;
  diagnostics.push(
    invalidOptionDiagnostic(operation, key, `${key} must be an integer from 1 to 100.`),
  );
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
