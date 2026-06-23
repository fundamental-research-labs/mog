import { WorkbookVersionImpl } from '../version';
import {
  HEAD_COMMIT_ID,
  PRINCIPAL_OTHER,
  PRINCIPAL_SECRET,
  RAW_CELL_VALUE,
  SECRET_PATH,
  digest,
  expectMergeReviewDiagnostic,
  expectNoDiagnosticLeaks,
  mergeResultIdForReviewDigest,
} from './version-review-provider-access-test-utils';

export function registerReviewProviderAccessMergeResolutionScenarios(): void {
  it('redacts principal mismatch and saved-resolution payload refs in provider diagnostics', async () => {
    const resultDigest = digest('7');
    const payloadId = `merge-payload:${resultDigest.digest}`;
    const resultId = mergeResultIdForReviewDigest(resultDigest);
    const canaries = [
      PRINCIPAL_SECRET,
      PRINCIPAL_OTHER,
      payloadId,
      resultId,
      resultDigest.digest,
      `sha256:${resultDigest.digest}`,
      RAW_CELL_VALUE,
      SECRET_PATH,
    ];
    const deniedProvider = {
      accessContext: { principalScope: PRINCIPAL_SECRET, diagnosticsAllowed: true },
      readGraphRegistry: async () => ({
        status: 'unsupported',
        registry: null,
        diagnostics: [
          {
            issueCode: 'VERSION_PERMISSION_DENIED',
            recoverability: 'unsupported',
            safeMessage: `Principal mismatch ${canaries.join(' ')}`,
            payload: {
              principalScope: PRINCIPAL_SECRET,
              expectedPrincipalScope: PRINCIPAL_SECRET,
              actualPrincipalScope: PRINCIPAL_OTHER,
              payloadId,
              resolutionSetDigest: resultDigest.digest,
              value: RAW_CELL_VALUE,
              path: SECRET_PATH,
            },
          },
        ],
      }),
      openGraph: async () => {
        throw new Error('openGraph should not be called');
      },
    };
    const version = new WorkbookVersionImpl({ versioning: { provider: deniedProvider } } as any);

    const saved = await version.saveMergeResolutions({
      resultId,
      resultDigest,
      redactionPolicyDigest: resultDigest,
      resolutions: [],
    });
    const payload = await version.putMergeResolutionPayload({
      resultId,
      resultDigest,
      redactionPolicyDigest: resultDigest,
      conflictId: 'conflict:w9-04:payload-ref',
      expectedConflictDigest: digest('6'),
      optionId: 'option:w9-04:payload-ref',
      kind: 'acceptTheirs',
      targetRef: 'refs/heads/main',
      expectedTargetHead: {
        commitId: HEAD_COMMIT_ID,
        revision: 'rv:w9-04-head',
      },
      value: RAW_CELL_VALUE,
      purpose: 'chooseValue',
    });

    for (const [result, operation] of [
      [saved, 'saveMergeResolutions'],
      [payload, 'putMergeResolutionPayload'],
    ] as const) {
      expectMergeReviewDiagnostic(
        result,
        operation,
        'VERSION_PERMISSION_DENIED',
        'Version merge review is not authorized for this caller.',
      );
      expectNoDiagnosticLeaks(result, canaries);
    }
  });
}
