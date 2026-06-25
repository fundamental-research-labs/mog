import type { VersionCreateReviewInput, VersionResult } from '@mog-sdk/contracts/api';

import { canonicalJsonStringify, cloneRecord, cloneRow } from './review-service-codec';
import { invalidClientRequestReuse, ok } from './review-service-record-store-helpers-results';
import type {
  WorkbookVersionReviewMutationLogEntry,
  WorkbookVersionReviewMutationOperation,
  WorkbookVersionReviewRecordStoreRow,
} from './review-service-record-store-helpers-types';

export function appendMutationLog(
  row: WorkbookVersionReviewRecordStoreRow,
  input: Omit<WorkbookVersionReviewMutationLogEntry, 'schemaVersion'>,
): WorkbookVersionReviewRecordStoreRow {
  return cloneRow({
    ...row,
    record: cloneRecord(input.resultRecord),
    mutationLog: [
      ...row.mutationLog,
      {
        schemaVersion: 1,
        operation: input.operation,
        clientRequestId: input.clientRequestId,
        fingerprint: input.fingerprint,
        resultRecord: cloneRecord(input.resultRecord),
        recordedAt: input.recordedAt,
      },
    ],
  });
}

export function idempotencyResult<T>(
  row: WorkbookVersionReviewRecordStoreRow,
  operation: WorkbookVersionReviewMutationOperation,
  clientRequestId: string,
  fingerprint: string,
): VersionResult<T> | null {
  const entry = row.mutationLog.find((item) => item.clientRequestId === clientRequestId);
  if (!entry) return null;
  if (entry.operation !== operation || entry.fingerprint !== fingerprint) {
    return invalidClientRequestReuse();
  }
  return ok(cloneRecord(entry.resultRecord) as T);
}

export function clientRequestIdWasUsed(
  row: WorkbookVersionReviewRecordStoreRow,
  clientRequestId: string,
): boolean {
  return row.mutationLog.some((entry) => entry.clientRequestId === clientRequestId);
}

export function createReviewFingerprint(input: VersionCreateReviewInput): unknown {
  return {
    clientRequestId: input.clientRequestId,
    subject: input.subject,
    title: input.title,
    createdBy: input.createdBy,
    baseCommitId: input.baseCommitId,
    headCommitId: input.headCommitId,
    redactionPolicy: input.redactionPolicy,
  };
}

export function mutationFingerprint(
  operation: WorkbookVersionReviewMutationOperation,
  value: unknown,
): string {
  return `${operation}:${canonicalJsonStringify(value)}`;
}
