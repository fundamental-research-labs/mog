import 'fake-indexeddb/auto';

import { describe, expect, it } from '@jest/globals';
import type {
  VersionCommitExpectedHead,
  VersionHead,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import { createIndexedDbVersionStoreProvider } from '../../../document/version-store/provider-indexeddb/backend';
import type {
  VersionDocumentScope,
  VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import { rootWrite } from './version-indexeddb-public-vc06-persistence-checkout-helpers-root-write';

type DocumentHandle = Awaited<ReturnType<typeof DocumentFactory.create>>;
type IndexedDbProvider = ReturnType<typeof createIndexedDbVersionStoreProvider>;

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const SOURCE_DOCUMENT_ID = `version-materialized-active-checkout-reopen-${RUN_ID}`;
const GRAPH_ID = 'graph-materialized-active-checkout-reopen';
const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: SOURCE_DOCUMENT_ID };
const MAIN_REF = 'refs/heads/main' as any;
const BRANCH_REF = 'scenario/materialized-active-checkout-reopen-incoming' as any;

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('WorkbookVersion materialized active checkout persisted reopen', () => {
  it('reopens with the active checkout materialized after persisted fast-forward applyMerge', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    let reloadedProvider: IndexedDbProvider | undefined;
    let sourceHandle: DocumentHandle | undefined;
    let reopenedHandle: DocumentHandle | undefined;
    let sourceWb: Workbook | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      assertInitializeSuccess(
        await provider.initializeGraph({
          expectedRegistryRevision: null,
          graphId: GRAPH_ID,
          rootWrite: await rootWrite(DOCUMENT_SCOPE, GRAPH_ID, 'root'),
        }),
      );

      sourceHandle = await createDocumentHandle(SOURCE_DOCUMENT_ID);
      installVersionDomainDetectorNoopsOnHandles(sourceHandle);

      sourceWb = await openVersionedWorkbook(sourceHandle, provider);
      const rootHead = await expectHead(sourceWb);

      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: rootHead.id,
            revision: requireRefRevision(rootHead),
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
      const expectedTargetHead: VersionCommitExpectedHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };
      sourceWb.markClean();

      const branch = await sourceWb.version.createBranch({
        name: BRANCH_REF,
        targetCommitId: oursCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        sourceWb.version.commit({
          targetRef: BRANCH_REF,
          expectedHead: {
            commitId: oursCommit.id,
            revision: branch.value.revision,
          },
        }),
      );
      sourceWb.markClean();

      const preview = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: MAIN_REF,
          expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok) throw new Error(`expected merge preview success: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'fastForward',
        resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
        resultDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        attemptPersistence: 'persisted',
        attemptKind: 'applyable',
        targetRef: 'refs/heads/main',
      });
      if (
        preview.value.status !== 'fastForward' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error('expected persisted fast-forward preview metadata');
      }

      await expect(
        sourceWb.version.checkout({ kind: 'ref', name: MAIN_REF }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });
      await expect(sourceWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: null });

      const activeCheckoutEvents: unknown[] = [];
      const unsubscribeActiveCheckoutEvents = sourceWb.on(
        'workbook:version-active-checkout-state-changed',
        (event) => activeCheckoutEvents.push(event),
      );
      const applied = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: MAIN_REF,
          expectedTargetHead,
          materializeActiveCheckout: true,
        },
      );
      unsubscribeActiveCheckoutEvents();
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'fastForwarded',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        commitRef: {
          id: theirsCommit.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: theirsCommit.id,
        mutationGuarantee: 'ref-fast-forwarded',
      });
      expect(activeCheckoutEvents).toEqual([
        expect.objectContaining({
          type: 'workbook:version-active-checkout-state-changed',
          activeCheckoutSession: {
            checkedOutCommitId: theirsCommit.id,
            branchName: 'main',
            refHeadAtMaterialization: theirsCommit.id,
            detached: false,
          },
          reason: 'checkout-materialized',
        }),
      ]);
      await expectMaterializedMainCheckout(sourceWb, theirsCommit);

      await sourceWb.close('skipSave');
      sourceWb = undefined;
      await sourceHandle.dispose();
      sourceHandle = undefined;
      await provider.close('test-teardown');

      reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      reopenedHandle = await createDocumentHandle(SOURCE_DOCUMENT_ID);
      installVersionDomainDetectorNoopsOnHandles(reopenedHandle);
      reopenedWb = await openVersionedWorkbook(reopenedHandle, reloadedProvider);

      await expect(reopenedWb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: theirsCommit.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });
      await expect(reopenedWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expect.objectContaining({ id: theirsCommit.id, parents: [oursCommit.id] }),
            expect.objectContaining({ id: oursCommit.id, parents: [baseCommit.id] }),
            expect.objectContaining({ id: baseCommit.id, parents: [rootHead.id] }),
          ]),
        },
      });
      await expectMaterializedMainCheckout(reopenedWb, theirsCommit);
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (sourceWb) await sourceWb.close('skipSave');
      if (sourceHandle) await sourceHandle.dispose();
      if (reloadedProvider) await reloadedProvider.close('test-teardown');
      await provider.close('test-teardown');
    }
  });

  it('clears the materialized active checkout marker after explicit commit checkout before reopen readback', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    let sourceHandle: DocumentHandle | undefined;
    let sourceWb: Workbook | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      assertInitializeSuccess(
        await provider.initializeGraph({
          expectedRegistryRevision: null,
          graphId: GRAPH_ID,
          rootWrite: await rootWrite(DOCUMENT_SCOPE, GRAPH_ID, 'root'),
        }),
      );

      sourceHandle = await createDocumentHandle(SOURCE_DOCUMENT_ID);
      installVersionDomainDetectorNoopsOnHandles(sourceHandle);

      sourceWb = await openVersionedWorkbook(sourceHandle, provider);
      const rootHead = await expectHead(sourceWb);

      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: rootHead.id,
            revision: requireRefRevision(rootHead),
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
      const expectedTargetHead: VersionCommitExpectedHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };
      sourceWb.markClean();

      const branch = await sourceWb.version.createBranch({
        name: BRANCH_REF,
        targetCommitId: oursCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        sourceWb.version.commit({
          targetRef: BRANCH_REF,
          expectedHead: {
            commitId: oursCommit.id,
            revision: branch.value.revision,
          },
        }),
      );
      sourceWb.markClean();

      const preview = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: MAIN_REF,
          expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok) throw new Error(`expected merge preview success: ${preview.error.code}`);
      if (
        preview.value.status !== 'fastForward' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error('expected persisted fast-forward preview metadata');
      }

      await expect(
        sourceWb.version.checkout({ kind: 'ref', name: MAIN_REF }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });

      const applied = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: MAIN_REF,
          expectedTargetHead,
          materializeActiveCheckout: true,
        },
      );
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      await expectMaterializedMainCheckout(sourceWb, theirsCommit);
      await expect(
        (await provider.openActiveCheckoutMaterializationStore()).read(),
      ).resolves.toMatchObject({
        checkedOutCommitId: theirsCommit.id,
        branchName: 'main',
        refHeadAtMaterialization: theirsCommit.id,
      });

      const checkoutPrior = await sourceWb.version.checkout({
        kind: 'commit',
        id: oursCommit.id,
      });
      if (!checkoutPrior.ok) {
        throw new Error(`expected explicit prior checkout success: ${checkoutPrior.error.code}`);
      }
      expect(checkoutPrior.value).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
      });
      await expect(
        (await provider.openActiveCheckoutMaterializationStore()).read(),
      ).resolves.toBeNull();
      await expect(sourceWb.version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          headCommitId: oursCommit.id,
          checkedOutCommitId: oursCommit.id,
          detached: true,
          stale: false,
        },
      });
      await expectPriorCommitReadback(sourceWb);

      await sourceWb.close('skipSave');
      sourceWb = undefined;

      reopenedWb = await openVersionedWorkbook(sourceHandle, provider);
      const reopenedSurface = await reopenedWb.version.getSurfaceStatus();
      expect(reopenedSurface.current).toMatchObject({
        headCommitId: theirsCommit.id,
        branchName: 'main',
        currentRefHeadId: theirsCommit.id,
        detached: false,
        stale: false,
      });
      expect(reopenedSurface.current).not.toHaveProperty('checkedOutCommitId');
      expect(reopenedSurface.current).not.toHaveProperty('refHeadAtMaterialization');
      await expectMergeCommitReadback(reopenedWb);
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      if (sourceHandle) await sourceHandle.dispose();
      await provider.close('test-teardown');
    }
  });
});

async function createDocumentHandle(documentId: string): Promise<DocumentHandle> {
  return DocumentFactory.create({
    documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
}

async function openVersionedWorkbook(
  handle: DocumentHandle,
  provider: IndexedDbProvider,
): Promise<Workbook> {
  const workbook = await handle.workbook({
    versioning: withVersionManifest({ provider }),
  });
  installVersionDomainDetectorNoopsOnWorkbook(workbook);
  return workbook;
}

async function expectMaterializedMainCheckout(
  workbook: Workbook,
  commit: WorkbookCommitSummary,
): Promise<void> {
  await expect(workbook.version.getSurfaceStatus()).resolves.toMatchObject({
    current: {
      headCommitId: commit.id,
      checkedOutCommitId: commit.id,
      branchName: 'main',
      refHeadAtMaterialization: commit.id,
      currentRefHeadId: commit.id,
      detached: false,
      stale: false,
    },
  });
  await expectMergeCommitReadback(workbook);
}

async function expectMergeCommitReadback(workbook: Workbook): Promise<void> {
  await expect(workbook.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
  await expect(workbook.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
  await expect(workbook.activeSheet.getCell('C1')).resolves.toMatchObject({ value: 'theirs' });
}

async function expectPriorCommitReadback(workbook: Workbook): Promise<void> {
  await expect(workbook.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
  await expect(workbook.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
  await expect(workbook.activeSheet.getCell('C1')).resolves.toMatchObject({ value: null });
}

async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected commit success: ${result.error.code}`);
  return result.value;
}

async function expectHead(workbook: Workbook): Promise<VersionHead> {
  const result = await workbook.version.getHead();
  if (!result.ok) throw new Error(`expected getHead success: ${result.error.code}`);
  return result.value;
}

function requireRefRevision(head: VersionHead) {
  if (!head.refRevision) throw new Error('expected head to expose a ref revision');
  return head.refRevision;
}

function assertInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
