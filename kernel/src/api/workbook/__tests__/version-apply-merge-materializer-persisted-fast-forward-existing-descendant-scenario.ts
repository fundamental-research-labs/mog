import {
  createPersistedFastForwardTheirsCommit,
  createPersistedMaterializerSourceFixture,
  expectCommit,
  expectHead,
  MATERIALIZER_TARGET_REF,
  openPersistedMaterializerWorkbook,
  requireRefRevision,
  type PersistedMaterializerWorkbook,
} from './version-apply-merge-materializer-persisted-test-utils';
import {
  expectPersistedFastForwardAppliedResult,
  expectPersistedFastForwardActiveCheckoutMaterialized,
  expectPersistedFastForwardCheckoutCells,
  expectPersistedFastForwardCommitGraph,
  expectPersistedFastForwardPreviewResult,
  expectPersistedFastForwardRepeatedApplyResult,
  expectPersistedFastForwardStaleTerminalResult,
} from './version-apply-merge-materializer-persisted-fast-forward-assertions';

export async function runPersistedFastForwardExistingDescendantScenario(): Promise<void> {
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
    const previewMetadata = expectPersistedFastForwardPreviewResult(preview.value, {
      oursCommit,
      theirsCommit,
    });

    const applied = await sourceWb.version.applyMerge(previewMetadata, {
      targetRef: MATERIALIZER_TARGET_REF as any,
      expectedTargetHead,
    });
    if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
    expectPersistedFastForwardAppliedResult(applied.value, {
      oursCommit,
      theirsCommit,
      previewMetadata,
    });

    const repeated = await sourceWb.version.applyMerge(previewMetadata, {
      targetRef: MATERIALIZER_TARGET_REF as any,
      expectedTargetHead,
    });
    if (!repeated.ok)
      throw new Error(`expected repeated applyMerge success: ${repeated.error.code}`);
    expectPersistedFastForwardRepeatedApplyResult(repeated.value, {
      oursCommit,
      theirsCommit,
      previewMetadata,
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
    const staleTerminal = await sourceWb.version.applyMerge(previewMetadata, {
      targetRef: MATERIALIZER_TARGET_REF as any,
      expectedTargetHead,
    });
    if (!staleTerminal.ok) {
      throw new Error(`expected stale terminal applyMerge result: ${staleTerminal.error.code}`);
    }
    expectPersistedFastForwardStaleTerminalResult(staleTerminal.value, {
      oursCommit,
      theirsCommit,
      previewMetadata,
      afterTerminalCommit,
    });

    const commits = await sourceWb.version.listCommits();
    if (!commits.ok) throw new Error(`expected listCommits success: ${commits.error.code}`);
    expectPersistedFastForwardCommitGraph(commits.value.items, {
      oursCommit,
      theirsCommit,
    });

    merged = await openPersistedMaterializerWorkbook(fixture);
    const checkoutMerged = await merged.workbook.version.checkout({
      kind: 'commit',
      id: theirsCommit.id,
    });
    if (!checkoutMerged.ok) {
      throw new Error(`expected fast-forwarded checkout success: ${checkoutMerged.error.code}`);
    }
    await expectPersistedFastForwardCheckoutCells(merged.workbook);
  } finally {
    if (merged) await merged.cleanup();
    await fixture.cleanup();
  }
}

export async function runPersistedFastForwardMaterializeActiveCheckoutScenario(): Promise<void> {
  const fixture = await createPersistedMaterializerSourceFixture(
    'graph-fast-forward-active-checkout',
  );
  let branchWriter: PersistedMaterializerWorkbook | undefined;

  try {
    const { sourceWb, baseCommit, oursCommit, expectedTargetHead } = fixture;
    branchWriter = await openPersistedMaterializerWorkbook(fixture);
    const theirsCommit = await createPersistedFastForwardTheirsCommit(sourceWb, {
      branchName: 'scenario/fast-forward-active-checkout-incoming',
      oursCommit,
      editWorkbook: branchWriter.workbook,
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
    const previewMetadata = expectPersistedFastForwardPreviewResult(preview.value, {
      oursCommit,
      theirsCommit,
    });

    const checkoutOurs = await sourceWb.version.checkout({
      kind: 'ref',
      name: MATERIALIZER_TARGET_REF as any,
    });
    if (!checkoutOurs.ok) {
      throw new Error(`expected source main checkout success: ${checkoutOurs.error.code}`);
    }

    const applied = await sourceWb.version.applyMerge(previewMetadata, {
      targetRef: MATERIALIZER_TARGET_REF as any,
      expectedTargetHead,
      materializeActiveCheckout: true,
    });
    if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
    expectPersistedFastForwardAppliedResult(applied.value, {
      oursCommit,
      theirsCommit,
      previewMetadata,
    });
    await expectPersistedFastForwardActiveCheckoutMaterialized(sourceWb, {
      oursCommit,
      theirsCommit,
    });
  } finally {
    if (branchWriter) await branchWriter.cleanup();
    await fixture.cleanup();
  }
}
