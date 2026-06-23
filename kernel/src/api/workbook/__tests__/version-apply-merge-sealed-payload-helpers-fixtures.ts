import type {
  VersionCommitExpectedHead,
  VersionHead,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import { objectRecord } from './version-apply-merge-sealed-payload-helpers-records';
import type {
  PersistedConflictPreview,
  SealedPayloadVersionStoreProvider,
} from './version-apply-merge-sealed-payload-helpers-types';

const DOCUMENT_ID = 'vc07-apply-merge-sealed-payload';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export async function withPersistedConflictPreview(
  graphId: string,
  run: (fixture: {
    readonly provider: SealedPayloadVersionStoreProvider;
    readonly graphId: string;
    readonly documentScope: VersionDocumentScope;
    readonly sourceWb: Workbook;
    readonly preview: PersistedConflictPreview;
    readonly expectedTargetHead: VersionCommitExpectedHead;
  }) => Promise<void>,
  versioning: Record<string, unknown> = {},
  conflictCells: readonly string[] = ['A1'],
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
    sourceWb = await sourceHandle.workbook({
      versioning: withVersionManifest({ provider, ...versioning }),
    });
    installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
    for (const cell of conflictCells) {
      await sourceWb.activeSheet.setCell(cell, 'base');
    }
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

    for (const cell of conflictCells) {
      await sourceWb.activeSheet.setCell(cell, 'ours');
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
    for (const cell of conflictCells) {
      await branchWb.activeSheet.setCell(cell, 'theirs');
    }
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
      !preview.value.resultDigest ||
      !preview.value.previewArtifactDigest
    ) {
      throw new Error('expected persisted conflicted preview metadata');
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

async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) {
    throw new Error(
      `expected commit success: ${result.error.code}: ${JSON.stringify(result.error)}`,
    );
  }
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

async function initializeInput(
  graphId: string,
  label: string,
  documentScope: VersionDocumentScope,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function documentScopeForGraph(graphId: string): VersionDocumentScope {
  return {
    workspaceId: `workspace-${graphId}`,
    documentId: `${DOCUMENT_ID}-${DOCUMENT_RUN_ID}-${graphId}`,
    principalScope: 'principal-user-1',
  };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
