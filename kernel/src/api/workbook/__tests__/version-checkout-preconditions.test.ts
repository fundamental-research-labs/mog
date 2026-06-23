import { jest } from '@jest/globals';

import {
  appendHeadCommit,
  cleanDirtyStatus,
  createWorkbook,
  expectHead,
  expectHeadUnchanged,
  failingMaterializer,
  initializeVersionGraph,
  resetCheckoutPreconditionMocks,
  setSurfaceStatusService,
  spyOnCheckoutService,
  unsafeAdmissionDirtyStatus,
  versioningRuntimeForWorkbook,
} from './version-checkout-preconditions-test-utils';

describe('WorkbookVersion checkout local preconditions', () => {
  beforeEach(() => {
    resetCheckoutPreconditionMocks();
  });

  it('rejects dirty checkout before materialization and leaves the active document and head unchanged', async () => {
    const graphId = 'graph-dirty-precondition';
    const { provider, initialized } = await initializeVersionGraph(graphId);
    const committed = await appendHeadCommit(provider, graphId, initialized, 'head-before-dirty');
    const checkoutSnapshotMaterializer = failingMaterializer();
    const wb = createWorkbook({
      provider,
      checkoutSnapshotMaterializer,
    });

    try {
      await wb.activeSheet.setCell('A1', 'dirty-local-value');
      const beforeHead = await expectHead(wb);

      const result = await wb.version.checkout({
        kind: 'commit',
        id: initialized.rootCommit.id,
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_DIRTY_WORKING_STATE',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
                  reason: 'dirtyWorkingState',
                  targetKind: 'commit',
                  commitId: initialized.rootCommit.id,
                }),
              }),
            }),
          ],
        },
      });
      expect(checkoutSnapshotMaterializer.applySnapshot).not.toHaveBeenCalled();
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'dirty-local-value',
      });
      await expectHeadUnchanged(wb, beforeHead);
      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: expect.objectContaining({ id: committed.commit.id }),
      });
    } finally {
      await wb.close('skipSave');
    }
  });

  it('rejects generic checkout admission denial before materialization and leaves active state unchanged', async () => {
    const graphId = 'graph-generic-admission-denial';
    const { provider, initialized } = await initializeVersionGraph(graphId);
    await appendHeadCommit(provider, graphId, initialized, 'head-before-admission-denial');
    const checkoutSnapshotMaterializer = failingMaterializer();
    const wb = createWorkbook({
      provider,
      checkoutSnapshotMaterializer,
    });

    try {
      await wb.activeSheet.setCell('A1', 'active-before-admission-denial');
      wb.markClean();
      const beforeHead = await expectHead(wb);
      setSurfaceStatusService(wb, {
        readDirtyStatus: async () => unsafeAdmissionDirtyStatus(),
        readActiveCheckoutSession: () => null,
      });

      const result = await wb.version.checkout({
        kind: 'commit',
        id: initialized.rootCommit.id,
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE',
              data: expect.objectContaining({
                recoverability: 'retry',
                redacted: true,
                payload: expect.objectContaining({
                  reason: 'checkoutPreflightUnsafe',
                  targetKind: 'commit',
                  commitId: initialized.rootCommit.id,
                }),
              }),
            }),
          ],
        },
      });
      expect(checkoutSnapshotMaterializer.applySnapshot).not.toHaveBeenCalled();
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-admission-denial',
      });
      await expectHeadUnchanged(wb, beforeHead);
    } finally {
      await wb.close('skipSave');
    }
  });

  it('rejects stale checkout preflight tokens after acquiring the local lease before service entry', async () => {
    const graphId = 'graph-stale-preflight-token';
    const { provider, initialized } = await initializeVersionGraph(graphId);
    await appendHeadCommit(provider, graphId, initialized, 'head-before-stale-token');
    const wb = createWorkbook({ provider, checkoutSnapshotMaterializer: failingMaterializer() });
    const runtime = versioningRuntimeForWorkbook(wb);
    const checkoutSpy = spyOnCheckoutService(runtime);
    const readDirtyStatus = jest
      .fn()
      .mockReturnValueOnce(cleanDirtyStatus('lease-token-before'))
      .mockReturnValueOnce(cleanDirtyStatus('lease-token-after'));

    try {
      await wb.activeSheet.setCell('A1', 'active-before-stale-preflight-token');
      wb.markClean();
      const beforeHead = await expectHead(wb);
      setSurfaceStatusService(wb, { readDirtyStatus, readActiveCheckoutSession: () => null });

      const result = await wb.version.checkout({
        kind: 'commit',
        id: initialized.rootCommit.id,
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_WRITE_FENCE_STALE',
              data: expect.objectContaining({
                recoverability: 'retry',
                redacted: true,
                payload: expect.objectContaining({
                  reason: 'checkoutPreflightStale',
                  targetKind: 'commit',
                  commitId: initialized.rootCommit.id,
                }),
              }),
            }),
          ],
        },
      });
      expect(readDirtyStatus).toHaveBeenCalledTimes(2);
      expect(checkoutSpy).not.toHaveBeenCalled();
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-stale-preflight-token',
      });
      await expectHeadUnchanged(wb, beforeHead);
    } finally {
      await wb.close('skipSave');
    }
  });

  it('preflights missing target commits before materialization and leaves active state unchanged', async () => {
    const graphId = 'graph-missing-target-preflight';
    const { provider } = await initializeVersionGraph(graphId);
    const checkoutSnapshotMaterializer = failingMaterializer();
    const wb = createWorkbook({ provider, checkoutSnapshotMaterializer });
    const missingCommitId = `commit:sha256:${'9'.repeat(64)}` as const;

    try {
      await wb.activeSheet.setCell('A1', 'active-before-missing-target');
      wb.markClean();
      const beforeHead = await expectHead(wb);

      const result = await wb.version.checkout({ kind: 'commit', id: missingCommitId });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_MISSING_COMMIT',
              data: expect.objectContaining({
                recoverability: 'repair',
                redacted: true,
                payload: expect.objectContaining({
                  targetKind: 'commit',
                  commitId: missingCommitId,
                }),
              }),
            }),
          ],
        },
      });
      expect(checkoutSnapshotMaterializer.applySnapshot).not.toHaveBeenCalled();
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-missing-target',
      });
      await expectHeadUnchanged(wb, beforeHead);
    } finally {
      await wb.close('skipSave');
    }
  });
});
