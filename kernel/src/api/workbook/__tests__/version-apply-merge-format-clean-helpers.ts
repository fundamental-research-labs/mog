import type {
  VersionCommitExpectedHead,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import {
  createFormatDocumentHandle,
  createFormatVersionStoreProvider,
  expectCommit,
  expectHead,
  expectInitializeSuccess,
  initializeInput,
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  requireRefRevision,
  withVersionManifest,
} from './version-apply-merge-format-test-utils';

export const FORMAT_CLEAN_TARGET_REF = 'refs/heads/main';

const FORMAT_CLEAN_BRANCH_NAME = 'scenario/format-incoming';

export type FormatCleanMergeFixture = {
  readonly sourceWb: Workbook;
  readonly baseCommit: WorkbookCommitSummary;
  readonly oursCommit: WorkbookCommitSummary;
  readonly theirsCommit: WorkbookCommitSummary;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly openMergedWorkbook: () => Promise<Workbook>;
  readonly cleanup: () => Promise<void>;
};

export async function createCleanSameCellFormatFixture(): Promise<FormatCleanMergeFixture> {
  const provider = createFormatVersionStoreProvider();
  const initialized = expectInitializeSuccess(
    await provider.initializeGraph(await initializeInput('graph-format-clean', 'root')),
  );

  const sourceHandle = await createFormatDocumentHandle();
  const branchHandle = await createFormatDocumentHandle();
  const mergedHandle = await createFormatDocumentHandle();
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
    await sourceWb.activeSheet.setCell('B1', 'base-seed');
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
      name: FORMAT_CLEAN_BRANCH_NAME as any,
      targetCommitId: baseCommit.id,
      expectedAbsent: true,
    });
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    await sourceWb.activeSheet.setCell('A1', 'ours');
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
    await branchWb.activeSheet.formats.set('A1', { bold: true, fontColor: '#FF0000' });
    const theirsCommit = await expectCommit(
      branchWb.version.commit({
        targetRef: FORMAT_CLEAN_BRANCH_NAME as any,
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
