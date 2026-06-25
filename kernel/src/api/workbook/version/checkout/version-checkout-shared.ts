import type {
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  REF_NAME_STORAGE_PREFIX,
  validateRefName,
} from '../../../../document/version-store/refs/ref-name';
import { mapPublicVersionDiagnosticRefName } from '../version-public-ref-selectors';

export const VERSION_HEAD_REF = 'HEAD';
export const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

export type CheckoutFailureMutationGuarantee =
  | 'no-workbook-mutation'
  | 'unknown-after-partial-mutation';

export function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

export function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (isRecord(value) && value.kind === 'counter' && typeof value.value === 'string') {
    return { kind: 'counter', value: value.value };
  }
  if (isRecord(value) && value.kind === 'opaque' && typeof value.value === 'string') {
    return { kind: 'opaque', value: value.value };
  }
  return undefined;
}

export function toPublicRefName(value: unknown): VersionMainRefName | VersionRefName | null {
  if (typeof value !== 'string') return null;
  if (value === VERSION_HEAD_REF) return null;
  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  const validated = validateRefName(branchName);
  if (!validated.ok) return null;
  return publicRefNameForBranch(validated.name);
}

export function publicRefNameForBranch(name: string): VersionMainRefName | VersionRefName {
  if (name === 'main') return VERSION_MAIN_REF;
  return `${REF_NAME_STORAGE_PREFIX}${name}` as VersionRefName;
}

export function safePublicDiagnosticRefName(value: string): string {
  if (value === VERSION_HEAD_REF || value === VERSION_MAIN_REF) return value;
  const publicRef = mapPublicVersionDiagnosticRefName(value);
  return publicRef ?? 'redacted';
}

export function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: ReadonlySet<string>,
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

export function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value;
}
