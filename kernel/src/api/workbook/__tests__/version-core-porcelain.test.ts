import { describe, expect, it, jest } from '@jest/globals';

import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph';
import { createVersion, ROOT_COMMIT_ID } from './version-diff-selector-test-utils';
import {
  emptySemanticDiffPage,
  emptySemanticDiffSuccess,
} from './version-diff-selector-ref-helpers';
import {
  commitProviderGraphChild,
  createProviderGraphFixture,
} from './version-refs-provider-fixtures';
import { createWorkbook } from './version-refs-provider-test-utils';
import {
  CHILD_COMMIT_ID,
  createCleanSurfaceDirtyStatus,
  createSurfaceReadyVersionWithContext,
  REF_REVISION,
} from './version-surface-status-test-utils';

const PORCELAIN_BRANCH_NAME = 'scenario/core-porcelain';
const PORCELAIN_BRANCH_REF = `refs/heads/${PORCELAIN_BRANCH_NAME}`;
const PORCELAIN_BASE_BRANCH_NAME = 'scenario/core-porcelain-base';
const PORCELAIN_BASE_BRANCH_REF = `refs/heads/${PORCELAIN_BASE_BRANCH_NAME}`;

describe('WorkbookVersion core porcelain facade', () => {
  it('projects current active checkout state through getCurrent', async () => {
    const { version } = createSurfaceReadyVersionWithContext(
      {},
      {
        surfaceStatusService: {
          readDirtyStatus: () => ({
            ...createCleanSurfaceDirtyStatus(),
            commitEligibleChanges: true,
          }),
          readActiveCheckoutSession: () => ({
            checkedOutCommitId: CHILD_COMMIT_ID,
            branchName: PORCELAIN_BRANCH_NAME,
            refHeadAtMaterialization: CHILD_COMMIT_ID,
            detached: false,
          }),
        },
      },
    );

    await expect(version.getCurrent()).resolves.toMatchObject({
      ok: true,
      value: {
        schemaVersion: 1,
        status: 'attached',
        branchName: PORCELAIN_BRANCH_NAME,
        refName: PORCELAIN_BRANCH_REF,
        commitId: CHILD_COMMIT_ID,
        checkedOutCommitId: CHILD_COMMIT_ID,
        refHeadAtMaterialization: CHILD_COMMIT_ID,
        currentRefHeadId: CHILD_COMMIT_ID,
        detached: false,
        stale: false,
        dirty: expect.objectContaining({
          source: 'VC-05',
          commitEligibleChanges: true,
        }),
        safeActions: expect.objectContaining({
          canCommit: true,
          canCreateBranch: true,
          canCheckout: true,
          canDiff: true,
        }),
      },
    });
  });

  it('rejects advanced commit options on commitCurrent before provider writes', async () => {
    const { version, commit } = createSurfaceReadyVersionWithContext();

    await expect(
      version.commitCurrent({
        message: 'blocked porcelain commit',
        targetRef: VERSION_GRAPH_MAIN_REF,
        expectedHead: {
          commitId: CHILD_COMMIT_ID,
          revision: REF_REVISION,
        },
      } as any),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.commitCurrent',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'commitCurrent',
                option: 'targetRef',
              }),
            }),
          }),
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'commitCurrent',
                option: 'expectedHead',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('creates a branch from the current provider head and lists display branch names', async () => {
    const fixture = await createProviderGraphFixture({
      graphId: 'core-porcelain-create-branch-from-current',
    });
    const currentHead = await commitProviderGraphChild(fixture, 'current-head');
    const wb = createWorkbook({
      versioning: {
        provider: fixture.provider,
      },
    });

    await expect(
      wb.version.createBranchFromCurrent(PORCELAIN_BRANCH_NAME, {
        expectedAbsent: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: PORCELAIN_BRANCH_REF,
        commitId: currentHead.commit.id,
      },
    });

    await expect(wb.version.listBranches({ prefix: PORCELAIN_BRANCH_NAME })).resolves.toMatchObject(
      {
        ok: true,
        value: {
          items: [
            expect.objectContaining({
              name: PORCELAIN_BRANCH_NAME,
              refName: PORCELAIN_BRANCH_REF,
              commitId: currentHead.commit.id,
            }),
          ],
          limit: 50,
        },
      },
    );
  });

  it('uses operation-specific branch capability denial for createBranchFromCurrent', async () => {
    const createBranch = jest.fn();
    const { version, readHead } = createSurfaceReadyVersionWithContext(
      {
        policySnapshot: {
          decisions: [{ capability: 'version:branch', decision: 'denied' }],
        },
      },
      {
        branchService: {
          createBranch,
        },
      },
    );

    await expect(version.createBranchFromCurrent(PORCELAIN_BRANCH_NAME)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:branch',
        dependency: 'hostCapability',
        retryable: false,
      },
    });
    expect(readHead).not.toHaveBeenCalled();
    expect(createBranch).not.toHaveBeenCalled();
  });

  it('routes checkoutBranch and checkoutCommit through checkout planning', async () => {
    const planCheckout = jest.fn(async (request: Readonly<Record<string, unknown>>) => {
      if (request.target === 'ref') {
        return plannedCheckoutResult(CHILD_COMMIT_ID, {
          kind: 'ref',
          refName: request.refName,
          commitId: CHILD_COMMIT_ID,
          refVersion: REF_REVISION,
        });
      }
      return plannedCheckoutResult(String(request.commitId), {
        kind: 'commit',
        commitId: request.commitId,
      });
    });
    const { version } = createSurfaceReadyVersionWithContext(
      {},
      {
        checkoutService: { planCheckout },
      },
    );

    const checkoutBranch = await version.checkoutBranch(PORCELAIN_BRANCH_NAME);
    if (!checkoutBranch.ok) {
      throw new Error(`expected checkoutBranch success: ${JSON.stringify(checkoutBranch.error)}`);
    }
    expect(checkoutBranch).toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
        plan: {
          commitId: CHILD_COMMIT_ID,
          target: {
            kind: 'ref',
            refName: PORCELAIN_BRANCH_REF,
            commitId: CHILD_COMMIT_ID,
            refRevision: REF_REVISION,
          },
        },
      },
    });
    expect(planCheckout).toHaveBeenNthCalledWith(1, {
      target: 'ref',
      refName: PORCELAIN_BRANCH_NAME,
    });

    const checkoutCommit = await version.checkoutCommit(ROOT_COMMIT_ID);
    if (!checkoutCommit.ok) {
      throw new Error(`expected checkoutCommit success: ${JSON.stringify(checkoutCommit.error)}`);
    }
    expect(checkoutCommit).toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
        plan: {
          commitId: ROOT_COMMIT_ID,
          target: {
            kind: 'commit',
            commitId: ROOT_COMMIT_ID,
          },
        },
      },
    });
    expect(planCheckout).toHaveBeenNthCalledWith(2, {
      target: 'commit',
      commitId: ROOT_COMMIT_ID,
    });
  });

  it('preserves explicit HEAD refs when diffing current checkout', async () => {
    const diff = jest.fn(async () => emptySemanticDiffSuccess());
    const version = createVersion(diff);

    const result = await version.diffCurrent({ kind: 'ref', name: 'HEAD' }, { pageSize: 17 });

    expect(result).toEqual({
      ok: true,
      value: emptySemanticDiffPage(17),
    });
    expect(diff).toHaveBeenCalledWith(
      { kind: 'ref', name: 'HEAD' },
      { kind: 'ref', name: 'HEAD' },
      { pageSize: 17 },
    );
  });

  it('canonicalizes diffBranch branch selectors before diff service calls', async () => {
    const diff = jest.fn(async () => emptySemanticDiffSuccess());
    const version = createVersion(diff);

    const result = await version.diffBranch(PORCELAIN_BRANCH_NAME, {
      against: { kind: 'branch', name: PORCELAIN_BASE_BRANCH_NAME },
      pageSize: 19,
    });

    expect(result).toEqual({
      ok: true,
      value: emptySemanticDiffPage(19),
    });
    expect(diff).toHaveBeenCalledWith(
      { kind: 'ref', name: PORCELAIN_BASE_BRANCH_REF },
      { kind: 'ref', name: PORCELAIN_BRANCH_REF },
      { pageSize: 19 },
    );
  });

  it('diffCurrent accepts commit ids as porcelain targets', async () => {
    const diff = jest.fn(async () => emptySemanticDiffSuccess());
    const version = createVersion(diff);

    const result = await version.diffCurrent(ROOT_COMMIT_ID, { pageSize: 23 });

    expect(result).toEqual({
      ok: true,
      value: emptySemanticDiffPage(23),
    });
    expect(diff).toHaveBeenCalledWith(
      { kind: 'commit', id: ROOT_COMMIT_ID },
      { kind: 'ref', name: 'HEAD' },
      { pageSize: 23 },
    );
  });
});

function plannedCheckoutResult(
  commitId: string,
  resolvedTarget: Readonly<Record<string, unknown>>,
) {
  return {
    ok: true,
    materialization: 'planned',
    plan: {
      strategy: 'fullSnapshot',
      commitId,
      parentCommitIds: [],
      resolvedTarget,
      requiredDependencies: [{ role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' }],
    },
    diagnostics: [],
    mutationGuarantee: 'no-workbook-mutation',
  };
}
