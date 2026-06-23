import type {
  VersionCommitExpectedHead,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import {
  createMaterializerDocumentHandle,
  expectCommit,
  expectHead,
  initializeMaterializerGraph,
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  requireRefRevision,
  withVersionManifest,
} from './version-apply-merge-materializer-test-utils';

export {
  MATERIALIZER_TARGET_REF,
  resolutionFor,
} from './version-apply-merge-materializer-test-utils';

type MaterializerCellEdit = readonly [cell: string, value: string];

export type MaterializerMergeFixtureInput = {
  readonly graphId: string;
  readonly branchName: string;
  readonly baseEdits: readonly MaterializerCellEdit[];
  readonly oursEdits: readonly MaterializerCellEdit[];
  readonly theirsEdits: readonly MaterializerCellEdit[];
};

export type MaterializerMergeFixture = {
  readonly sourceWb: Workbook;
  readonly baseCommit: WorkbookCommitSummary;
  readonly oursCommit: WorkbookCommitSummary;
  readonly theirsCommit: WorkbookCommitSummary;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly openMergedWorkbook: () => Promise<Workbook>;
  readonly cleanup: () => Promise<void>;
};

export async function createMaterializerMergeFixture(
  input: MaterializerMergeFixtureInput,
): Promise<MaterializerMergeFixture> {
  const { documentScope, provider, initialized } = await initializeMaterializerGraph(input.graphId);
  const sourceHandle = await createMaterializerDocumentHandle(documentScope);
  const branchHandle = await createMaterializerDocumentHandle(documentScope);
  const mergedHandle = await createMaterializerDocumentHandle(documentScope);
  installVersionDomainDetectorNoopsOnHandles(sourceHandle, branchHandle, mergedHandle);

  let sourceWb: Workbook | undefined;
  let branchWb: Workbook | undefined;
  let mergedWb: Workbook | undefined;

  const cleanup = async () => {
    if (mergedWb) await mergedWb.close('skipSave');
    if (branchWb) await branchWb.close('skipSave');
    if (sourceWb) await sourceWb.close('skipSave');
    await mergedHandle.dispose();
    await branchHandle.dispose();
    await sourceHandle.dispose();
  };

  try {
    sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
    installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
    await applyCellEdits(sourceWb, input.baseEdits);
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

    const branch = await sourceWb.version.createBranch({
      name: input.branchName as any,
      targetCommitId: baseCommit.id,
      expectedAbsent: true,
    });
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    await applyCellEdits(sourceWb, input.oursEdits);
    const oursCommit = await expectCommit(
      sourceWb.version.commit({
        expectedHead: {
          commitId: baseCommit.id,
          revision: requireRefRevision(baseHead),
        },
      }),
    );
    const oursHead = await expectHead(sourceWb);

    branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
    installVersionDomainDetectorNoopsOnWorkbook(branchWb);
    const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
    if (!checkoutBase.ok) {
      throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
    }
    installVersionDomainDetectorNoopsOnWorkbook(branchWb);
    await applyCellEdits(branchWb, input.theirsEdits);
    const theirsCommit = await expectCommit(
      branchWb.version.commit({
        targetRef: input.branchName as any,
        expectedHead: {
          commitId: baseCommit.id,
          revision: branch.value.revision,
        },
      }),
    );

    const openMergedWorkbook = async () => {
      if (mergedWb) return mergedWb;
      mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(mergedWb);
      return mergedWb;
    };

    return {
      sourceWb,
      baseCommit,
      oursCommit,
      theirsCommit,
      expectedTargetHead: {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      },
      openMergedWorkbook,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function applyCellEdits(wb: Workbook, edits: readonly MaterializerCellEdit[]) {
  for (const [cell, value] of edits) {
    await wb.activeSheet.setCell(cell, value);
  }
}
