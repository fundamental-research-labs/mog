import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  DOCUMENT_SCOPE,
  REVIEW_ID,
  createReviewInput,
  expectDeniedReviewDiagnostic,
  inaccessibleReviewResult,
  versionForProvider,
} from './version-review-provider-test-utils';

export function registerReviewProviderCoreDiagnosticScenarios(): void {
  it('redacts inaccessible provider review read and write diagnostics', async () => {
    const store = {
      documentScope: DOCUMENT_SCOPE,
      getReview: async () => inaccessibleReviewResult('getReview', 'version:reviewRead'),
      createReview: async () => inaccessibleReviewResult('createReview', 'version:reviewWrite'),
    };
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE }) as any;
    provider.openWorkbookVersionReviewRecordStore = async () => store;
    const version = versionForProvider(provider);

    const read = await version.getReview({ reviewId: REVIEW_ID });
    const write = await version.createReview(createReviewInput('inaccessible-write-review'));
    expectDeniedReviewDiagnostic(read, 'getReview', 'version:reviewRead');
    expectDeniedReviewDiagnostic(write, 'createReview', 'version:reviewWrite');
  });
}
