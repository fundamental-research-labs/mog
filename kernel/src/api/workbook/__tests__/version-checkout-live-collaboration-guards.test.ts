import { jest } from '@jest/globals';

import { checkoutWorkbookVersion } from '../version-checkout';
import {
  cleanSurfaceDirtyStatus,
  createMockCtx,
  createWorkbook,
  plannedCheckoutResult,
} from './version-checkout-live-collaboration-test-utils';

describe('WorkbookVersion checkout live collaboration guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks checkout while workbook recalculation is pending', async () => {
    const commitId = `commit:sha256:${'a'.repeat(64)}`;
    const checkout = jest.fn(async () => plannedCheckoutResult(commitId));
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout },
        },
      }),
    });

    wb.suspendCalc();

    await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
      dirty: {
        pendingRecalc: true,
        checkoutSafe: false,
        unsafeReasons: [
          expect.objectContaining({
            code: 'version.surfaceStatus.pendingRecalc',
          }),
        ],
      },
    });

    await expect(wb.version.checkout({ kind: 'commit', id: commitId })).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_PENDING_RECALC',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                reason: 'pendingRecalc',
                targetKind: 'commit',
                commitId: 'redacted',
              }),
            }),
          }),
        ],
      },
    });
    expect(checkout).not.toHaveBeenCalled();
  });

  it('blocks checkout when the active checkout session is stale relative to its ref head', async () => {
    const checkedOutCommitId = `commit:sha256:${'b'.repeat(64)}`;
    const movedCommitId = `commit:sha256:${'c'.repeat(64)}`;
    const targetCommitId = `commit:sha256:${'d'.repeat(64)}`;
    const checkout = jest.fn(async () => plannedCheckoutResult(targetCommitId));
    const readRef = jest.fn(async (name: string) => ({
      status: 'success',
      ref: {
        name,
        commitId: movedCommitId,
        revision: { kind: 'counter', value: '2' },
      },
      diagnostics: [],
    }));

    await expect(
      checkoutWorkbookVersion(
        createMockCtx({
          versioning: {
            checkoutService: { checkout },
            readService: { readRef },
            surfaceStatusService: {
              readDirtyStatus: () => cleanSurfaceDirtyStatus(),
              readActiveCheckoutSession: () => ({
                checkedOutCommitId,
                branchName: 'main',
                refHeadAtMaterialization: checkedOutCommitId,
                detached: false,
              }),
            },
          },
        }),
        { kind: 'commit', id: targetCommitId },
      ),
    ).resolves.toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
          recoverability: 'retry',
          payload: expect.objectContaining({
            reason: 'staleWorkspaceHead',
            staleReason: 'refMoved',
            targetKind: 'commit',
            commitId: targetCommitId,
            branchName: 'main',
            checkedOutCommitId,
            refHeadAtMaterialization: checkedOutCommitId,
            currentRefHeadId: movedCommitId,
          }),
        }),
      ],
    });
    expect(readRef).toHaveBeenCalledWith('refs/heads/main');
    expect(checkout).not.toHaveBeenCalled();
  });
});
