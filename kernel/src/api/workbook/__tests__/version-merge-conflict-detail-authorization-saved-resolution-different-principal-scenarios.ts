import { WorkbookVersionImpl } from '../version';
import type {
  VersionAccessContext,
  VersionGraphNamespace,
} from '../../../document/version-store/provider';
import {
  TARGET_REF,
  conflictDigestObject,
  resolutionFor,
  withReviewArtifact,
} from './version-merge-conflict-detail-authorization-test-utils';

export function registerSavedResolutionDifferentPrincipalScenarios(): void {
  it('reads saved-resolution conflict detail under a different authorized principal', async () => {
    await withReviewArtifact(
      'saved-resolution-different-principal',
      async ({ provider, version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
          throw new Error('expected saved resolution artifact digests');
        }

        const readerAccess: VersionAccessContext = { principalScope: 'principal-reader' };
        const openGraphCalls: {
          readonly namespace: VersionGraphNamespace;
          readonly accessContext: VersionAccessContext | undefined;
        }[] = [];
        const openGraph = (
          namespace: VersionGraphNamespace,
          accessContext?: VersionAccessContext,
        ) => {
          openGraphCalls.push({ namespace, accessContext });
          return provider.openGraph(namespace, accessContext);
        };
        const readerVersion = new WorkbookVersionImpl({
          versioning: {
            provider: {
              accessContext: readerAccess,
              readGraphRegistry: () => provider.readGraphRegistry(),
              openGraph,
            },
          },
        } as any);

        const detail = await readerVersion.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: saved.value.resolutionSetDigest,
          resolvedAttemptDigest: saved.value.resolvedAttemptDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
        });

        expect(openGraphCalls).toEqual([expect.objectContaining({ accessContext: readerAccess })]);
        expect(detail).toMatchObject({
          ok: true,
          value: {
            kind: 'resolutionPayload',
            valueRole: 'resolved',
            value: { kind: 'value', value: 'theirs' },
          },
        });
      },
      { accessContext: { principalScope: 'principal-writer' } },
    );
  });
}
