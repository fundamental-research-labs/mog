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
