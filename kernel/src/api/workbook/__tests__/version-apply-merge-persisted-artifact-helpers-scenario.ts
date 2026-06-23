import type { VersionHead, Workbook, WorkbookCommitSummary } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  documentScopeForGraph,
  expectInitializeSuccess,
  initializeInput,
} from './version-apply-merge-persisted-artifact-helpers-graph';
import type {
  PersistedMergeScenario,
  PersistedMergeScenarioOptions,
} from './version-apply-merge-persisted-artifact-helpers-types';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';

function createHeadlessDocumentHandle(documentScope: VersionDocumentScope) {
  return DocumentFactory.create({
    documentId: documentScope.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
}

export async function createPersistedMergeScenario(
  options: PersistedMergeScenarioOptions,
): Promise<PersistedMergeScenario> {
  const { graphId } = options;
  const documentScope = documentScopeForGraph(graphId);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);

  const sourceHandle = await createHeadlessDocumentHandle(documentScope);
  const branchHandle = await createHeadlessDocumentHandle(documentScope);
  const mergedHandle = await createHeadlessDocumentHandle(documentScope);
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
    const sourceVersioning: Record<string, unknown> = { provider };
    if (options.applyMergeService !== undefined) {
      sourceVersioning.applyMergeService = options.applyMergeService;
    }
    sourceWb = await sourceHandle.workbook({
      versioning: withVersionManifest(sourceVersioning),
    });
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
      name: options.branchName as any,
      targetCommitId: baseCommit.id,
      expectedAbsent: true,
    });
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    for (const edit of options.ours) {
      await sourceWb.activeSheet.setCell(edit.cell, edit.value);
    }
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
    for (const edit of options.theirs) {
      await branchWb.activeSheet.setCell(edit.cell, edit.value);
    }
    const theirsCommit = await expectCommit(
      branchWb.version.commit({
        targetRef: options.branchName as any,
        expectedHead: {
          commitId: baseCommit.id,
          revision: branch.value.revision,
        },
      }),
    );

    return {
      graphId,
      documentScope,
      namespace,
      provider,
      sourceWb,
      branchWb,
      baseCommit,
      oursCommit,
      theirsCommit,
      expectedTargetHead: {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      },
      openMergedWorkbook: async () => {
        if (mergedWb) return mergedWb;
        mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
        installVersionDomainDetectorNoopsOnWorkbook(mergedWb);
        return mergedWb;
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected commit success: ${result.error.code}`);
  return result.value;
}

async function expectHead(wb: Workbook): Promise<VersionHead> {
  const result = await wb.version.getHead();
  if (!result.ok) throw new Error(`expected getHead success: ${result.error.code}`);
  return result.value;
}

function requireRefRevision(head: VersionHead) {
  if (!head.refRevision) throw new Error('expected head to expose a ref revision');
  return head.refRevision;
}
