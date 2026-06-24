import type { IndexedDbVersionStoreProvider } from '../../../document/version-store/provider-indexeddb/backend';
import {
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  DocumentFactory,
  GRAPH_ID,
  expectInitializeSuccess,
  failFirstIntentCompletion,
  namespaceForDocumentScope,
  rootWrite,
  withVersionManifest,
  type Workbook,
} from './version-indexeddb-persisted-apply-recovery-test-utils';
import { applyInterruptedResolvedMergeCommit } from './version-indexeddb-persisted-apply-recovery-merge-commit-stage-interruption';
import { createPersistedConflictedMergePreview } from './version-indexeddb-persisted-apply-recovery-merge-commit-stage-preview';
import type { MergeCommitRecoveryStage } from './version-indexeddb-persisted-apply-recovery-merge-commit-types';

type DocumentHandle = Awaited<ReturnType<typeof DocumentFactory.create>>;

export async function stageInterruptedResolvedMergeCommitIntent(
  provider: IndexedDbVersionStoreProvider,
): Promise<MergeCommitRecoveryStage> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, GRAPH_ID);
  expectInitializeSuccess(
    await provider.initializeGraph({
      expectedRegistryRevision: null,
      graphId: GRAPH_ID,
      rootWrite: await rootWrite('merge-recovery-root'),
    }),
  );
  const failingProvider = failFirstIntentCompletion(provider);
  let firstHandle: DocumentHandle | undefined;
  let branchHandle: DocumentHandle | undefined;
  let firstWb: Workbook | undefined;
  let branchWb: Workbook | undefined;

  try {
    firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    branchHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    firstWb = await firstHandle.workbook({
      versioning: withVersionManifest({ provider: failingProvider }),
    });
    branchWb = await branchHandle.workbook({
      versioning: withVersionManifest({ provider: failingProvider }),
    });

    const previewStage = await createPersistedConflictedMergePreview({
      firstWb,
      branchWb,
    });
    const interruptedStage = await applyInterruptedResolvedMergeCommit({
      provider,
      namespace,
      workbook: firstWb,
      previewStage,
    });

    await branchWb.close('skipSave');
    branchWb = undefined;
    await branchHandle.dispose();
    branchHandle = undefined;
    await firstWb.close('skipSave');
    firstWb = undefined;
    await firstHandle.dispose();
    firstHandle = undefined;

    return {
      namespace,
      ...previewStage,
      ...interruptedStage,
    };
  } finally {
    if (branchWb) await branchWb.close('skipSave');
    if (branchHandle) await branchHandle.dispose();
    if (firstWb) await firstWb.close('skipSave');
    if (firstHandle) await firstHandle.dispose();
  }
}
