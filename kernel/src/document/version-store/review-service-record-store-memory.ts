import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import type { WorkbookVersionReviewRecordMemoryBackend } from './review-service-record-store-memory-backend';
import { WorkbookVersionReviewRecordStoreImpl } from './review-service-record-store-impl';
import type { WorkbookVersionReviewRecordStore } from './review-service-record-store-types';

export class InMemoryWorkbookVersionReviewRecordStore
  extends WorkbookVersionReviewRecordStoreImpl
  implements WorkbookVersionReviewRecordStore
{
  constructor(options: {
    readonly documentScope: VersionDocumentScope;
    readonly backend: WorkbookVersionReviewRecordMemoryBackend;
  }) {
    const documentScope = normalizeVersionDocumentScope(options.documentScope);
    const documentScopeKey = versionDocumentScopeKey(documentScope);
    super({
      documentScope,
      adapter: {
        async readRow(reviewId) {
          return options.backend.get(documentScopeKey, reviewId);
        },
        async listRows() {
          return options.backend.list(documentScopeKey);
        },
        async mutateRow(reviewId, mutator) {
          const result = mutator(options.backend.get(documentScopeKey, reviewId));
          if (result.action === 'put') options.backend.put(result.row);
          return result.result;
        },
        async mutateRows(mutator) {
          const result = mutator(options.backend.list(documentScopeKey));
          if (result.action === 'put') options.backend.put(result.row);
          return result.result;
        },
      },
    });
  }
}
