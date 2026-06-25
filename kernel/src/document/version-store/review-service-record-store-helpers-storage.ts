import { cloneRow, isWorkbookVersionReviewRecordStoreRow } from './review-service-codec';
import type { WorkbookVersionReviewRecordStoreRow } from './review-service-record-store-helpers-types';

export function reviewRecordStorageKey(documentScopeKey: string, reviewId: string): string {
  return `${documentScopeKey}\u0000review\u0000${reviewId}`;
}

export function storedWorkbookVersionReviewRecordRow(
  row: WorkbookVersionReviewRecordStoreRow,
): WorkbookVersionReviewRecordStoreRow {
  return cloneRow(row);
}

export function decodeStoredWorkbookVersionReviewRecordRow(
  value: unknown,
  documentScopeKey: string,
): WorkbookVersionReviewRecordStoreRow | null {
  if (!isWorkbookVersionReviewRecordStoreRow(value)) return null;
  return value.documentScopeKey === documentScopeKey ? cloneRow(value) : null;
}
