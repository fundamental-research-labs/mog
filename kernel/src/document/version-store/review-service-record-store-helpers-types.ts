import type { VersionResult, WorkbookVersionReviewRecord } from '@mog-sdk/contracts/api';

export type WorkbookVersionReviewMutationOperation =
  | 'createReview'
  | 'appendReviewDecision'
  | 'updateReviewStatus';

export type WorkbookVersionReviewMutationLogEntry = {
  readonly schemaVersion: 1;
  readonly operation: WorkbookVersionReviewMutationOperation;
  readonly clientRequestId: string;
  readonly fingerprint: string;
  readonly resultRecord: WorkbookVersionReviewRecord;
  readonly recordedAt: string;
};

export type WorkbookVersionReviewRecordStoreRow = {
  readonly schemaVersion: 1;
  readonly operation: 'workbook-version-review-record';
  readonly documentScopeKey: string;
  readonly createClientRequestId: string;
  readonly record: WorkbookVersionReviewRecord;
  readonly mutationLog: readonly WorkbookVersionReviewMutationLogEntry[];
};

export type WorkbookVersionReviewRecordMemoryBackendSnapshot = {
  readonly rows: readonly WorkbookVersionReviewRecordStoreRow[];
};

export type ReviewRecordRowMutation<T> =
  | {
      readonly action: 'put';
      readonly row: WorkbookVersionReviewRecordStoreRow;
      readonly result: VersionResult<T>;
    }
  | { readonly action: 'none'; readonly result: VersionResult<T> };
