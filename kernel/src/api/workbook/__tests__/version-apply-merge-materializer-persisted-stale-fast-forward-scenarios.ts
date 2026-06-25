import { expect, it } from '@jest/globals';

import {
  createPersistedFastForwardTheirsCommit,
  createPersistedMaterializerSourceFixture,
  expectCommit,
  expectHead,
  expectPersistedPreviewMetadata,
  MATERIALIZER_TARGET_REF,
} from './version-apply-merge-materializer-persisted-test-utils';

export function describePersistedStaleFastForwardMaterializerScenarios(): void {
  it('rejects a persisted fast-forward result when the target head moved after preview', async () => {
    const fixture = await createPersistedMaterializerSourceFixture('graph-stale-fast-forward');

    try {
      const { sourceWb, baseCommit, oursCommit, expectedTargetHead } = fixture;
      const theirsCommit = await createPersistedFastForwardTheirsCommit(sourceWb, {
        branchName: 'scenario/stale-fast-forward-incoming',
        oursCommit,
      });

      const preview = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok)
        throw new Error(`expected persisted merge preview success: ${preview.error.code}`);
      const previewMetadata = expectPersistedPreviewMetadata(
        preview.value,
        'fastForward',
        'expected fast-forward preview to expose a persisted result id and digest',
      );
      const staleExpectedTargetHead = {
        commitId: expectedTargetHead.commitId,
        revision: { ...expectedTargetHead.revision },
      };

      await sourceWb.activeSheet.setCell('D1', 'interloper');
      const interloperCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: expectedTargetHead,
        }),
      );

      const stale = await sourceWb.version.applyMerge(previewMetadata, {
        targetRef: MATERIALIZER_TARGET_REF as any,
        expectedTargetHead: staleExpectedTargetHead,
      });
      expect(stale).toMatchObject({
        ok: true,
        value: {
          status: 'staleTargetHead',
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
          targetRef: MATERIALIZER_TARGET_REF,
          headBefore: oursCommit.id,
          headAfter: interloperCommit.id,
          mutationGuarantee: 'ref-not-mutated',
        },
      });

      const head = await expectHead(sourceWb);
      expect(head).toMatchObject({
        id: interloperCommit.id,
        refRevision: { kind: 'counter', value: '3' },
      });
    } finally {
      await fixture.cleanup();
    }
  });
}
