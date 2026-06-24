import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMergeResult,
  VersionMergeResultId,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import type { MaterializerGraphSetup } from './version-apply-merge-materializer-test-utils';
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
  expectCommit,
  expectHead,
  MATERIALIZER_TARGET_REF,
  requireRefRevision,
} from './version-apply-merge-materializer-test-utils';

export type PersistedMaterializerPreviewMetadata = {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
};

export type PersistedMaterializerSourceFixture = {
  readonly documentScope: MaterializerGraphSetup['documentScope'];
  readonly provider: MaterializerGraphSetup['provider'];
  readonly initialized: MaterializerGraphSetup['initialized'];
  readonly sourceWb: Workbook;
  readonly baseCommit: WorkbookCommitSummary;
  readonly oursCommit: WorkbookCommitSummary;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly cleanup: () => Promise<void>;
};

export type PersistedMaterializerWorkbook = {
  readonly workbook: Workbook;
  readonly cleanup: () => Promise<void>;
};

export async function createPersistedMaterializerSourceFixture(
  graphId: string,
): Promise<PersistedMaterializerSourceFixture> {
  const { documentScope, provider, initialized } = await initializeMaterializerGraph(graphId);
  const sourceHandle = await createMaterializerDocumentHandle(documentScope);
  installVersionDomainDetectorNoopsOnHandles(sourceHandle);
  let sourceWb: Workbook | undefined;

  const cleanup = async () => {
    if (sourceWb) await sourceWb.close('skipSave');
    await sourceHandle.dispose();
  };

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

    return {
      documentScope,
      provider,
      initialized,
      sourceWb,
      baseCommit,
      oursCommit,
      expectedTargetHead: {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function openPersistedMaterializerWorkbook(
  fixture: Pick<PersistedMaterializerSourceFixture, 'documentScope' | 'provider'>,
): Promise<PersistedMaterializerWorkbook> {
  const handle = await createMaterializerDocumentHandle(fixture.documentScope);
  installVersionDomainDetectorNoopsOnHandles(handle);
  let workbook: Workbook | undefined;

  const cleanup = async () => {
    if (workbook) await workbook.close('skipSave');
    await handle.dispose();
  };

  try {
    workbook = await handle.workbook({
      versioning: withVersionManifest({ provider: fixture.provider }),
    });
    installVersionDomainDetectorNoopsOnWorkbook(workbook);
    return { workbook, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function createPersistedFastForwardTheirsCommit(
  sourceWb: Workbook,
  input: {
    readonly branchName: string;
    readonly oursCommit: WorkbookCommitSummary;
    readonly editWorkbook?: Workbook;
  },
): Promise<WorkbookCommitSummary> {
  const branch = await sourceWb.version.createBranch({
    name: input.branchName as any,
    targetCommitId: input.oursCommit.id,
    expectedAbsent: true,
  });
  if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

  const editWorkbook = input.editWorkbook ?? sourceWb;
  if (editWorkbook !== sourceWb) {
    const checkoutOurs = await editWorkbook.version.checkout({
      kind: 'commit',
      id: input.oursCommit.id,
    });
    if (!checkoutOurs.ok) {
      throw new Error(`expected branch edit checkout success: ${checkoutOurs.error.code}`);
    }
  }

  await editWorkbook.activeSheet.setCell('C1', 'theirs');
  return expectCommit(
    editWorkbook.version.commit({
      targetRef: input.branchName as any,
      expectedHead: {
        commitId: input.oursCommit.id,
        revision: branch.value.revision,
      },
    }),
  );
}

export function expectPersistedPreviewMetadata(
  value: VersionMergeResult,
  status: 'fastForward' | 'alreadyMerged',
  message: string,
): PersistedMaterializerPreviewMetadata {
  if (value.status !== status || !value.resultId || !value.resultDigest) {
    throw new Error(message);
  }
  return { resultId: value.resultId, resultDigest: value.resultDigest };
}
