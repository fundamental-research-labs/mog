import type { VersionCommitExpectedHead, Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import {
  documentScopeForGraph,
  expectCommit,
  expectHead,
  expectInitializeSuccess,
  initializeInput,
  requireRefRevision,
} from './version-merge-review-endpoints-helpers-context';
import type { PersistedConflictPreview } from './version-merge-review-endpoints-helpers-types';
import {
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';

export async function withPersistedConflictPreview(
  graphId: string,
  run: (fixture: {
    readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
    readonly graphId: string;
    readonly documentScope: VersionDocumentScope;
    readonly sourceWb: Workbook;
    readonly preview: PersistedConflictPreview;
    readonly expectedTargetHead: VersionCommitExpectedHead;
  }) => Promise<void>,
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);

  const sourceHandle = await DocumentFactory.create({
    documentId: documentScope.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  const branchHandle = await DocumentFactory.create({
    documentId: documentScope.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  let sourceWb: Workbook | undefined;
  let branchWb: Workbook | undefined;

  try {
    const versioning = withVersionManifest({ provider });
    sourceWb = await sourceHandle.workbook({ versioning });
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

    const branch = await sourceWb.version.createBranch({
      name: `scenario/${graphId}` as any,
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

    branchWb = await branchHandle.workbook({ versioning });
    installVersionDomainDetectorNoopsOnWorkbook(branchWb);
    const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
    if (!checkoutBase.ok)
      throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
    installVersionDomainDetectorNoopsOnWorkbook(branchWb);
    await expect(branchWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
    await branchWb.activeSheet.setCell('A1', 'theirs');
    await expect(branchWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'theirs' });
    const theirsCommit = await expectCommit(
      branchWb.version.commit({
        targetRef: `scenario/${graphId}` as any,
        expectedHead: {
          commitId: baseCommit.id,
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
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead,
        persistReviewRecord: true,
      },
    );
    if (
      !preview.ok ||
      preview.value.status !== 'conflicted' ||
      !preview.value.resultId ||
      !preview.value.resultDigest
    ) {
      throw new Error(`expected persisted conflicted preview metadata: ${JSON.stringify(preview)}`);
    }

    await run({
      provider,
      graphId,
      documentScope,
      sourceWb,
      preview: preview.value as PersistedConflictPreview,
      expectedTargetHead,
    });
  } finally {
    if (branchWb) await branchWb.close('skipSave');
    if (sourceWb) await sourceWb.close('skipSave');
    await branchHandle.dispose();
    await sourceHandle.dispose();
  }
}
