import { expect, it } from '@jest/globals';

import {
  createPersistedFastForwardTheirsCommit,
  createPersistedMaterializerSourceFixture,
  expectCommit,
  expectHead,
  expectPersistedPreviewMetadata,
  MATERIALIZER_TARGET_REF,
  openPersistedMaterializerWorkbook,
  requireRefRevision,
  type PersistedMaterializerWorkbook,
} from './version-apply-merge-materializer-persisted-test-utils';

export function describePersistedFastForwardMaterializerScenarios(): void {
  it('applies a persisted fast-forward merge result to an existing descendant commit', async () => {
    const fixture = await createPersistedMaterializerSourceFixture('graph-fast-forward');
    let merged: PersistedMaterializerWorkbook | undefined;

    try {
      const { sourceWb, baseCommit, oursCommit, expectedTargetHead } = fixture;
      const theirsCommit = await createPersistedFastForwardTheirsCommit(sourceWb, {
        branchName: 'scenario/fast-forward-incoming',
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
      expect(preview.value).toMatchObject({
        status: 'fastForward',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
        resultDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        attemptPersistence: 'persisted',
        attemptKind: 'applyable',
        targetRef: MATERIALIZER_TARGET_REF,
      });
      const previewMetadata = expectPersistedPreviewMetadata(
        preview.value,
        'fastForward',
        'expected fast-forward preview to expose a persisted result id and digest',
      );

      const applied = await sourceWb.version.applyMerge(
        previewMetadata,
        {
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'fastForwarded',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        commitRef: {
          id: theirsCommit.id,
          refName: MATERIALIZER_TARGET_REF,
          resolvedFrom: MATERIALIZER_TARGET_REF,
          refRevision: { kind: 'counter', value: '3' },
        },
        resultId: previewMetadata.resultId,
        resultDigest: previewMetadata.resultDigest,
        resolutionSetDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        resolvedAttemptDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        targetRef: MATERIALIZER_TARGET_REF,
        headBefore: oursCommit.id,
        headAfter: theirsCommit.id,
        changes: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-fast-forwarded',
      });

      const repeated = await sourceWb.version.applyMerge(
        previewMetadata,
        {
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
        },
      );
      if (!repeated.ok)
        throw new Error(`expected repeated applyMerge success: ${repeated.error.code}`);
      expect(repeated.value).toMatchObject({
        status: 'alreadyApplied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        commitRef: {
          id: theirsCommit.id,
          refName: MATERIALIZER_TARGET_REF,
          resolvedFrom: MATERIALIZER_TARGET_REF,
        },
        resultId: previewMetadata.resultId,
        resultDigest: previewMetadata.resultDigest,
        targetRef: MATERIALIZER_TARGET_REF,
        headBefore: oursCommit.id,
        headAfter: theirsCommit.id,
        changes: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-not-mutated',
      });

      const fastForwardedHead = await expectHead(sourceWb);
      await sourceWb.activeSheet.setCell('D1', 'after-terminal');
      const afterTerminalCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: theirsCommit.id,
            revision: requireRefRevision(fastForwardedHead),
          },
        }),
      );
      const staleTerminal = await sourceWb.version.applyMerge(
        previewMetadata,
        {
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
        },
      );
      if (!staleTerminal.ok) {
        throw new Error(`expected stale terminal applyMerge result: ${staleTerminal.error.code}`);
      }
      expect(staleTerminal.value).toMatchObject({
        status: 'staleTargetHead',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: previewMetadata.resultId,
        resultDigest: previewMetadata.resultDigest,
        targetRef: MATERIALIZER_TARGET_REF,
        headBefore: oursCommit.id,
        headAfter: afterTerminalCommit.id,
        changes: [],
        mutationGuarantee: 'ref-not-mutated',
      });

      const commits = await sourceWb.version.listCommits();
      if (!commits.ok) throw new Error(`expected listCommits success: ${commits.error.code}`);
      expect(commits.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: theirsCommit.id,
            parents: [oursCommit.id],
          }),
        ]),
      );
      expect(
        commits.value.items.some(
          (item) => item.parents[0] === oursCommit.id && item.parents[1] === theirsCommit.id,
        ),
      ).toBe(false);

      merged = await openPersistedMaterializerWorkbook(fixture);
      const checkoutMerged = await merged.workbook.version.checkout({
        kind: 'commit',
        id: theirsCommit.id,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected fast-forwarded checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(merged.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'base',
      });
      await expect(merged.workbook.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'ours',
      });
      await expect(merged.workbook.activeSheet.getCell('C1')).resolves.toMatchObject({
        value: 'theirs',
      });
    } finally {
      if (merged) await merged.cleanup();
      await fixture.cleanup();
    }
  });
}
