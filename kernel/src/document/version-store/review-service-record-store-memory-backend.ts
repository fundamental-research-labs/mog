import { cloneRow } from './review-service-codec';
import {
  reviewRecordStorageKey,
  type WorkbookVersionReviewRecordMemoryBackendSnapshot,
  type WorkbookVersionReviewRecordStoreRow,
} from './review-service-record-store-helpers';

export class WorkbookVersionReviewRecordMemoryBackend {
  private readonly rowsByKey = new Map<string, WorkbookVersionReviewRecordStoreRow>();

  get(documentScopeKey: string, reviewId: string): WorkbookVersionReviewRecordStoreRow | undefined {
    return cloneRow(this.rowsByKey.get(reviewRecordStorageKey(documentScopeKey, reviewId)));
  }

  put(row: WorkbookVersionReviewRecordStoreRow): void {
    this.rowsByKey.set(reviewRecordStorageKey(row.documentScopeKey, row.record.id), cloneRow(row));
  }

  list(documentScopeKey: string): readonly WorkbookVersionReviewRecordStoreRow[] {
    return [...this.rowsByKey.values()]
      .filter((row) => row.documentScopeKey === documentScopeKey)
      .map((row) => cloneRow(row));
  }

  exportSnapshot(): WorkbookVersionReviewRecordMemoryBackendSnapshot {
    return { rows: [...this.rowsByKey.values()].map((row) => cloneRow(row)) };
  }

  static fromSnapshot(
    snapshot: WorkbookVersionReviewRecordMemoryBackendSnapshot,
  ): WorkbookVersionReviewRecordMemoryBackend {
    const backend = new WorkbookVersionReviewRecordMemoryBackend();
    for (const row of snapshot.rows) backend.put(row);
    return backend;
  }
}
