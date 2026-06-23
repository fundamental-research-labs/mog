import type { Workbook } from '@mog-sdk/contracts/api';

import {
  createMaterializerDocumentHandle,
  expectCommit,
  expectHead,
  initializeMaterializerGraph,
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  MATERIALIZER_TARGET_REF,
  requireRefRevision,
  withVersionManifest,
} from './version-apply-merge-materializer-test-utils';

describe('WorkbookVersion applyMerge production materializer persisted results', () => {
  it('applies a persisted fast-forward merge result to an existing descendant commit', async () => {
    const { documentScope, provider, initialized } =
      await initializeMaterializerGraph('graph-fast-forward');

    const sourceHandle = await createMaterializerDocumentHandle(documentScope);
    const mergedHandle = await createMaterializerDocumentHandle(documentScope);
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, mergedHandle);
    let sourceWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      const baseHead = await expectHead(sourceWb);

      await sourceWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(sourceWb);

      const branch = await sourceWb.version.createBranch({
        name: 'scenario/fast-forward-incoming' as any,
        targetCommitId: oursCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        sourceWb.version.commit({
          targetRef: 'scenario/fast-forward-incoming' as any,
          expectedHead: {
            commitId: oursCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      const expectedTargetHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };
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
      if (
        preview.value.status !== 'fastForward' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error('expected fast-forward preview to expose a persisted result id and digest');
      }

      const applied = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
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
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
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
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
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
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
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
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
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
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
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

      mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(mergedWb);
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: theirsCommit.id,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected fast-forwarded checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: 'theirs' });
    } finally {
      if (mergedWb) await mergedWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await mergedHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('applies a persisted already-merged result without moving the target ref', async () => {
    const { documentScope, provider, initialized } =
      await initializeMaterializerGraph('graph-already-merged');

    const sourceHandle = await createMaterializerDocumentHandle(documentScope);
    installVersionDomainDetectorNoopsOnHandles(sourceHandle);
    let sourceWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      const baseHead = await expectHead(sourceWb);

      await sourceWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(sourceWb);
      const expectedTargetHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };

      const preview = await sourceWb.version.merge(
        {
          base: initialized.rootCommit.id,
          ours: oursCommit.id,
          theirs: baseCommit.id,
        },
        {
          mode: 'preview',
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok)
        throw new Error(`expected already-merged preview success: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'alreadyMerged',
        ours: oursCommit.id,
        theirs: baseCommit.id,
        resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
        resultDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        attemptPersistence: 'persisted',
        attemptKind: 'applyable',
        targetRef: MATERIALIZER_TARGET_REF,
      });
      if (
        preview.value.status !== 'alreadyMerged' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error(
          'expected already-merged preview to expose a persisted result id and digest',
        );
      }

      const applied = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok)
        throw new Error(`expected already-merged apply success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'alreadyMerged',
        ours: oursCommit.id,
        theirs: baseCommit.id,
        commitRef: {
          id: oursCommit.id,
          refName: MATERIALIZER_TARGET_REF,
          resolvedFrom: MATERIALIZER_TARGET_REF,
        },
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        targetRef: MATERIALIZER_TARGET_REF,
        headBefore: oursCommit.id,
        headAfter: oursCommit.id,
        changes: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-not-mutated',
      });

      const head = await expectHead(sourceWb);
      expect(head).toMatchObject({
        id: oursCommit.id,
        refRevision: requireRefRevision(oursHead),
      });

      await sourceWb.activeSheet.setCell('C1', 'after-already-merged');
      const afterAlreadyMergedCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: oursCommit.id,
            revision: requireRefRevision(head),
          },
        }),
      );
      const staleTerminal = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
        },
      );
      if (!staleTerminal.ok) {
        throw new Error(
          `expected stale already-merged terminal result: ${staleTerminal.error.code}`,
        );
      }
      expect(staleTerminal.value).toMatchObject({
        status: 'staleTargetHead',
        ours: oursCommit.id,
        theirs: baseCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        targetRef: MATERIALIZER_TARGET_REF,
        headBefore: oursCommit.id,
        headAfter: afterAlreadyMergedCommit.id,
        changes: [],
        mutationGuarantee: 'ref-not-mutated',
      });
    } finally {
      if (sourceWb) await sourceWb.close('skipSave');
      await sourceHandle.dispose();
    }
  });

  it('rejects a persisted fast-forward result when the target head moved after preview', async () => {
    const { documentScope, provider, initialized } =
      await initializeMaterializerGraph('graph-stale-fast-forward');

    const sourceHandle = await createMaterializerDocumentHandle(documentScope);
    installVersionDomainDetectorNoopsOnHandles(sourceHandle);
    let sourceWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      const baseHead = await expectHead(sourceWb);

      await sourceWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(sourceWb);

      const branch = await sourceWb.version.createBranch({
        name: 'scenario/stale-fast-forward-incoming' as any,
        targetCommitId: oursCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        sourceWb.version.commit({
          targetRef: 'scenario/stale-fast-forward-incoming' as any,
          expectedHead: {
            commitId: oursCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      const expectedTargetHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };
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
      if (
        preview.value.status !== 'fastForward' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error('expected fast-forward preview to expose a persisted result id and digest');
      }
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

      const stale = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead: staleExpectedTargetHead,
        },
      );
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
      if (sourceWb) await sourceWb.close('skipSave');
      await sourceHandle.dispose();
    }
  });
});
