import { WorkbookVersionImpl } from '../version';
import {
  conflictDigestObject,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  withReviewArtifact,
} from './version-merge-review-endpoints-contracts-test-utils';

export function registerArtifactProviderRedactionScenarios(): void {
  it('redacts provider diagnostics while reading saved resolution artifacts', async () => {
    await withReviewArtifact('saved-resolution-redaction', async ({ provider, preview }) => {
      const canaries = [
        'xl/worksheets/sheet1.xml',
        'cells/A1',
        'sk_live_saved_resolution_secret',
        preview.resultDigest.digest,
      ];
      const wrappedProvider = {
        accessContext: provider.accessContext,
        readGraphRegistry: () => provider.readGraphRegistry(),
        openGraph: async (...args: Parameters<typeof provider.openGraph>) => {
          const graph = await provider.openGraph(...args);
          return {
            getObjectRecord: async (ref: any) => {
              if (ref.objectType === 'workbook.mergeResolutionSet.v1') {
                throw Object.assign(new Error(canaries.join(' ')), {
                  diagnostics: [
                    {
                      issueCode: 'VERSION_PERMISSION_DENIED',
                      safeMessage: `Cannot read ${canaries.join(' ')}`,
                    },
                  ],
                });
              }
              return graph.getObjectRecord(ref);
            },
          };
        },
      };
      const version = new WorkbookVersionImpl({ versioning: { provider: wrappedProvider } } as any);
      const conflict = preview.conflicts[0];
      const result = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'resolved',
        purpose: 'resolution',
        resolutionSetDigest: { algorithm: 'sha256', digest: '7'.repeat(64) },
      });

      expectMergeReviewFailure(result, 'getMergeConflictDetail', 'VERSION_PERMISSION_DENIED');
      expectNoDiagnosticLeaks(result, canaries);
    });
  });
}
