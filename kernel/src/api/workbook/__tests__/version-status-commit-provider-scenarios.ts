import { jest } from '@jest/globals';

import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import { attachWorkbookVersionSurfaceStatusService } from '../version-wiring';
import { createWorkbookVersionSurfaceStatusService } from '../version/surface-status/version-surface-status-service';
import { VERSION_STATUS_CREATED_AT as CREATED_AT } from './version-status-test-utils';
import {
  createWorkbookVersion,
  versionContext,
} from './version-commit-snapshot-root-helpers-versioning';
import {
  DOCUMENT_SCOPE,
  createEmptyNormalCommitCapture,
  createNormalCommitCapture,
  createWorkbook,
  expectInitializeSuccess,
  initializeInput,
} from './version-status-workbook-test-utils';

export function registerVersionStatusCommitProviderScenarios() {
  it('routes public commit through the attached provider-backed normal commit service', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const captureNormalCommit = jest.fn(createNormalCommitCapture('child'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    const committedResult = await wb.version.commit({
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
        symbolicHeadRevision: initialized.symbolicHead.revision,
      },
    });
    if (!committedResult.ok) {
      throw new Error(`expected provider-backed commit success: ${committedResult.error.code}`);
    }
    const committed = committedResult.value;

    expect(captureNormalCommit).toHaveBeenCalledTimes(1);
    expect(committed).toMatchObject({
      parents: [initialized.rootCommit.id],
      createdAt: CREATED_AT,
      author: { actorKind: 'user', displayName: 'User One', redacted: true },
    });
    expect(committed.id).not.toBe(initialized.rootCommit.id);

    await expect(wb.version.getHead()).resolves.toMatchObject({
      ok: true,
      value: {
        id: committed.id,
        refName: VERSION_GRAPH_MAIN_REF,
        resolvedFrom: 'HEAD',
        refRevision: { kind: 'counter', value: '1' },
      },
    });
    await expect(wb.version.listCommits()).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({ id: committed.id, parents: [initialized.rootCommit.id] }),
          expect.objectContaining({ id: initialized.rootCommit.id, parents: [] }),
        ],
        limit: 50,
      },
    });
    const status = await wb.version.getStatus();
    expect(status.checkout).toMatchObject({ stage: 'present', available: true });
    expect(status.checkout.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'version.checkout.serviceAttached',
    ]);

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readHead()).resolves.toMatchObject({
      status: 'success',
      head: {
        id: committed.id,
        refRevision: { kind: 'counter', value: '1' },
      },
    });
  });

  it('routes direct WorkbookVersionImpl implicit commits through the active checkout branch', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-direct-active-branch', 'root'),
    );
    expectInitializeSuccess(initialized);
    const captureNormalCommit = jest.fn(createNormalCommitCapture('direct-active-branch-child'));
    const version = createWorkbookVersion({
      provider,
      captureNormalCommit,
    });
    const branchResult = await version.createBranch({
      name: 'scenario/direct-active-branch' as any,
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
    });
    if (!branchResult.ok) {
      throw new Error(`expected branch create success: ${branchResult.error.code}`);
    }
    const branch = branchResult.value;
    const activeCheckoutStateChanges: unknown[] = [];
    const surfaceStatusService = createWorkbookVersionSurfaceStatusService({
      readDirtyState: () => ({
        hasUncommittedLocalChanges: false,
        calculationState: 'done',
        checkoutInProgress: false,
        revision: 0,
        contextGeneration: 0,
      }),
      notifyActiveCheckoutStateChanged: (change) => activeCheckoutStateChanges.push(change),
    });
    surfaceStatusService.recordActiveCheckoutBranchCommit({
      commitId: initialized.rootCommit.id,
      refName: branch.name,
    });
    attachWorkbookVersionSurfaceStatusService(versionContext(version), surfaceStatusService);

    const committedResult = await version.commit({
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: branch.revision,
      },
    });
    if (!committedResult.ok) {
      throw new Error(
        `expected direct active-branch commit success: ${committedResult.error.code}`,
      );
    }
    const committed = committedResult.value;

    expect(captureNormalCommit).toHaveBeenCalledTimes(1);
    expect(surfaceStatusService.readActiveCheckoutSession()).toMatchObject({
      checkedOutCommitId: committed.id,
      branchName: 'scenario/direct-active-branch',
      refHeadAtMaterialization: committed.id,
      detached: false,
    });
    expect(activeCheckoutStateChanges).toEqual([
      expect.objectContaining({
        activeCheckoutSession: expect.objectContaining({
          checkedOutCommitId: initialized.rootCommit.id,
          branchName: 'scenario/direct-active-branch',
        }),
        previousActiveCheckoutSession: null,
        statusRevision: 1,
        reason: 'branch-head-advanced',
      }),
      expect.objectContaining({
        activeCheckoutSession: expect.objectContaining({
          checkedOutCommitId: committed.id,
          branchName: 'scenario/direct-active-branch',
        }),
        previousActiveCheckoutSession: expect.objectContaining({
          checkedOutCommitId: initialized.rootCommit.id,
          branchName: 'scenario/direct-active-branch',
        }),
        statusRevision: 2,
        reason: 'branch-head-advanced',
      }),
    ]);
    await expect(version.readRef(branch.name)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: branch.name,
          commitId: committed.id,
        },
      },
    });
    await expect(version.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: VERSION_GRAPH_MAIN_REF,
          commitId: initialized.rootCommit.id,
        },
      },
    });
    await expect(version.getHead()).resolves.toMatchObject({
      ok: true,
      value: {
        id: committed.id,
        refName: branch.name,
        resolvedFrom: branch.name,
      },
    });
  });

  it('blocks direct WorkbookVersionImpl implicit commits from detached checkout', async () => {
    const detachedCommitId = `commit:sha256:${'8'.repeat(64)}` as const;
    const surfaceStatusService = createWorkbookVersionSurfaceStatusService({
      readDirtyState: () => ({
        hasUncommittedLocalChanges: false,
        calculationState: 'done',
        checkoutInProgress: false,
        revision: 0,
        contextGeneration: 0,
      }),
    });
    surfaceStatusService.recordCheckoutMaterialization({
      commitId: detachedCommitId,
      resolvedTarget: { kind: 'commit', commitId: detachedCommitId },
    } as never);
    const commit = jest.fn();
    const version = createWorkbookVersion({
      writeService: { commit },
    });
    attachWorkbookVersionSurfaceStatusService(versionContext(version), surfaceStatusService);

    await expect(version.commit({ message: 'detached implicit commit' })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'commitGraphWrite',
                reason: 'detachedCheckout',
                option: 'targetRef',
              }),
            }),
          }),
        ],
      },
    });
    expect(commit).not.toHaveBeenCalled();
    expect(surfaceStatusService.readActiveCheckoutSession()).toMatchObject({
      checkedOutCommitId: detachedCommitId,
      detached: true,
    });
  });

  it('blocks explicit-target commits when the active checkout session is stale', async () => {
    const branchRef = 'refs/heads/scenario/stale-explicit-commit' as const;
    const checkedOutCommit = `commit:sha256:${'6'.repeat(64)}` as const;
    const branchHead = `commit:sha256:${'7'.repeat(64)}` as const;
    const surfaceStatusService = createWorkbookVersionSurfaceStatusService({
      readDirtyState: () => ({
        hasUncommittedLocalChanges: false,
        calculationState: 'done',
        checkoutInProgress: false,
        revision: 0,
        contextGeneration: 0,
      }),
    });
    surfaceStatusService.recordActiveCheckoutBranchCommit({
      commitId: checkedOutCommit,
      refName: branchRef,
    });
    const readRef = jest.fn(async (name: string) => ({
      status: 'success',
      ref: {
        name,
        commitId: branchHead,
        revision: { kind: 'counter' as const, value: '2' },
      },
    }));
    const commit = jest.fn();
    const version = createWorkbookVersion({
      readService: { readRef },
      writeService: { commit },
    });
    attachWorkbookVersionSurfaceStatusService(versionContext(version), surfaceStatusService);

    await expect(
      version.commit({
        targetRef: branchRef,
        expectedHead: {
          commitId: checkedOutCommit,
          revision: { kind: 'counter' as const, value: '1' },
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD' })],
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('returns graph-uninitialized diagnostics before capture when provider registry is absent', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const captureNormalCommit = jest.fn(createNormalCommitCapture('should-not-run'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_GRAPH_UNINITIALIZED',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              redacted: true,
            }),
          }),
        ],
      },
    });
    expect(captureNormalCommit).not.toHaveBeenCalled();
  });

  it('rejects empty normal capture without advancing the initialized main ref', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const captureNormalCommit = jest.fn(createEmptyNormalCommitCapture('empty'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_CHANGE_SET',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              redacted: true,
            }),
          }),
        ],
      },
    });
    expect(captureNormalCommit).toHaveBeenCalledTimes(1);

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readHead()).resolves.toMatchObject({
      status: 'success',
      head: {
        id: initialized.rootCommit.id,
        refRevision: initialized.initialHead.revision,
      },
    });
  });
}
