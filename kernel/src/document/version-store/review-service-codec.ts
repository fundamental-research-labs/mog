import type {
  WorkbookVersionReviewDecision,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewStatus,
  WorkbookVersionReviewSubject,
} from '@mog-sdk/contracts/api';

import type {
  WorkbookVersionReviewMutationLogEntry,
  WorkbookVersionReviewRecordStoreRow,
} from './review-service-record-store';

const REVIEW_ID_RE = /^review:sha256:[0-9a-f]{64}$/;
const REVIEW_DECISION_ID_RE = /^review-decision:sha256:[0-9a-f]{64}$/;

export function isWorkbookVersionReviewRecordStoreRow(
  value: unknown,
): value is WorkbookVersionReviewRecordStoreRow {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.operation !== 'workbook-version-review-record') return false;
  if (typeof value.documentScopeKey !== 'string') return false;
  if (typeof value.createClientRequestId !== 'string') return false;
  if (!isWorkbookVersionReviewRecord(value.record)) return false;
  return Array.isArray(value.mutationLog) && value.mutationLog.every(isMutationLogEntry);
}

export function cloneRow(
  row: WorkbookVersionReviewRecordStoreRow,
): WorkbookVersionReviewRecordStoreRow;
export function cloneRow(row: undefined): undefined;
export function cloneRow(
  row: WorkbookVersionReviewRecordStoreRow | undefined,
): WorkbookVersionReviewRecordStoreRow | undefined;
export function cloneRow(
  row: WorkbookVersionReviewRecordStoreRow | undefined,
): WorkbookVersionReviewRecordStoreRow | undefined {
  return row === undefined ? undefined : cloneJson(row);
}

export function cloneRecord(record: WorkbookVersionReviewRecord): WorkbookVersionReviewRecord {
  return cloneJson(record);
}

export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON number must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  if (!isRecord(value)) throw new Error('value must be canonical JSON');
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`)
    .join(',')}}`;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isMutationLogEntry(value: unknown): value is WorkbookVersionReviewMutationLogEntry {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    (value.operation === 'createReview' ||
      value.operation === 'appendReviewDecision' ||
      value.operation === 'updateReviewStatus') &&
    typeof value.clientRequestId === 'string' &&
    typeof value.fingerprint === 'string' &&
    isWorkbookVersionReviewRecord(value.resultRecord) &&
    typeof value.recordedAt === 'string'
  );
}

function isWorkbookVersionReviewRecord(value: unknown): value is WorkbookVersionReviewRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (typeof value.id !== 'string' || !REVIEW_ID_RE.test(value.id)) return false;
  if (typeof value.documentId !== 'string') return false;
  if (!isReviewSubject(value.subject)) return false;
  if (!isReviewStatus(value.status)) return false;
  if (
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 1
  ) {
    return false;
  }
  if (!isRecord(value.createdBy)) return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (!Array.isArray(value.decisions) || !value.decisions.every(isReviewDecision)) return false;
  return isRecord(value.redaction) && Array.isArray(value.diagnostics);
}

function isReviewSubject(value: unknown): value is WorkbookVersionReviewSubject {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'commit':
      return typeof value.commitId === 'string';
    case 'commitRange':
      return typeof value.baseCommitId === 'string' && typeof value.headCommitId === 'string';
    case 'proposal':
      return (
        typeof value.proposalId === 'string' &&
        typeof value.baseCommitId === 'string' &&
        typeof value.headCommitId === 'string'
      );
    case 'merge':
      return typeof value.mergePreviewId === 'string';
    case 'conflict':
      return typeof value.mergePreviewId === 'string' && typeof value.conflictId === 'string';
    default:
      return false;
  }
}

function isReviewStatus(value: unknown): value is WorkbookVersionReviewStatus {
  return (
    value === 'open' ||
    value === 'approved' ||
    value === 'changes_requested' ||
    value === 'rejected' ||
    value === 'applied' ||
    value === 'superseded' ||
    value === 'stale'
  );
}

function isReviewDecision(value: unknown): value is WorkbookVersionReviewDecision {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    REVIEW_DECISION_ID_RE.test(value.id) &&
    isRecord(value.target) &&
    typeof value.decision === 'string' &&
    isRecord(value.reviewer) &&
    typeof value.createdAt === 'string'
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
