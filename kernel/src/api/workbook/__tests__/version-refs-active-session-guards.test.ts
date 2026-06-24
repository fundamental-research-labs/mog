import { describe, expect, it } from '@jest/globals';

import type { VersionResult, VersionRef } from '@mog-sdk/contracts/api';

import { createInMemoryBranchService } from '../../../document/version-store/branch-service';
import { createInMemoryRefStore } from '../../../document/version-store/refs/ref-store';
import { WorkbookVersionImpl } from '../version';
import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  COMMIT_C,
  CREATED_AT,
  refVersion,
} from './version-refs-test-utils';

type BranchAdvanceMethod = 'fastForwardBranch' | 'updateBranch';
type BranchDeleteMethod = 'deleteBranch' | 'deleteRef';

describe('WorkbookVersion public ref active-session guards', () => {
  it.each<BranchAdvanceMethod>(['fastForwardBranch', 'updateBranch'])(
    'blocks %s on a stale active checkout branch before advancing the ref',
    async (method) => {
      const branchName =
        method === 'fastForwardBranch'
          ? 'scenario/stale-active-fast-forward-branch'
          : 'scenario/stale-active-update-branch';
      const { branchService, version } = createVersionWithActiveSession({
        branchName,
        checkedOutCommitId: COMMIT_A,
        refHeadAtMaterialization: COMMIT_A,
      });

      expect(
        branchService.createBranch({
          name: branchName,
          targetCommitId: COMMIT_A,
          expectedAbsent: true,
          createdBy: AUTHOR,
        }),
      ).toMatchObject({ ok: true });
      expect(
        branchService.fastForwardBranch({
          name: branchName,
          nextCommitId: COMMIT_B,
          expectedOldCommitId: COMMIT_A,
          expectedRefVersion: refVersion('0'),
        }),
      ).toMatchObject({ ok: true });

      const options = {
        name: branchName as any,
        nextCommitId: COMMIT_C,
        expectedHead: COMMIT_B,
        expectedRefRevision: refVersion('1'),
      };
      const blocked =
        method === 'fastForwardBranch'
          ? await version.fastForwardBranch(options)
          : await version.updateBranch(options);

      expectStaleActiveCheckoutFailure(blocked, method);
      expect(branchService.readBranch(branchName)).toMatchObject({
        ok: true,
        branch: {
          ref: {
            targetCommitId: COMMIT_B,
            refVersion: refVersion('1'),
          },
        },
      });
    },
  );

  it.each<BranchAdvanceMethod>(['fastForwardBranch', 'updateBranch'])(
    'blocks %s when the active checkout session has a stale workspace head',
    async (method) => {
      const branchName =
        method === 'fastForwardBranch'
          ? 'scenario/stale-session-fast-forward-branch'
          : 'scenario/stale-session-update-branch';
      const { branchService, version } = createVersionWithActiveSession({
        branchName,
        checkedOutCommitId: COMMIT_B,
        refHeadAtMaterialization: COMMIT_A,
      });

      expect(
        branchService.createBranch({
          name: branchName,
          targetCommitId: COMMIT_A,
          expectedAbsent: true,
          createdBy: AUTHOR,
        }),
      ).toMatchObject({ ok: true });

      const options = {
        name: branchName as any,
        nextCommitId: COMMIT_C,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      };
      const blocked =
        method === 'fastForwardBranch'
          ? await version.fastForwardBranch(options)
          : await version.updateBranch(options);

      expectStaleActiveCheckoutFailure(blocked, method);
      expect(branchService.readBranch(branchName)).toMatchObject({
        ok: true,
        branch: {
          ref: {
            targetCommitId: COMMIT_A,
            refVersion: refVersion('0'),
          },
        },
      });
    },
  );

  it.each<BranchDeleteMethod>(['deleteBranch', 'deleteRef'])(
    'blocks %s on the active checkout branch before tombstoning the ref',
    async (method) => {
      const branchName = 'scenario/delete-active-session';
      const { branchService, version } = createVersionWithActiveSession({
        branchName,
        checkedOutCommitId: COMMIT_A,
        refHeadAtMaterialization: COMMIT_A,
        useLegacySessionReaderAlias: method === 'deleteRef',
      });

      expect(
        branchService.createBranch({
          name: branchName,
          targetCommitId: COMMIT_A,
          expectedAbsent: true,
          createdBy: AUTHOR,
        }),
      ).toMatchObject({ ok: true });

      const blocked =
        method === 'deleteBranch'
          ? await version.deleteBranch({
              name: branchName as any,
              expectedHead: COMMIT_A,
              expectedRefRevision: refVersion('0'),
            })
          : await version.deleteRef({
              name: `refs/heads/${branchName}` as any,
              expectedHead: COMMIT_A,
              expectedRefRevision: refVersion('0'),
            });

      expect(blocked).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_REF_WRITE_UNAVAILABLE',
              data: expect.objectContaining({
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  issue: 'activeBranchDelete',
                  operation: method,
                }),
              }),
            }),
          ],
        },
      });
      expect(branchService.readBranch(branchName)).toMatchObject({
        ok: true,
        branch: {
          ref: {
            state: 'live',
            targetCommitId: COMMIT_A,
            refVersion: refVersion('0'),
          },
        },
      });
    },
  );
});

function createVersionWithActiveSession(input: {
  readonly branchName: string;
  readonly checkedOutCommitId: string;
  readonly refHeadAtMaterialization: string;
  readonly useLegacySessionReaderAlias?: boolean;
}) {
  const refStore = createInMemoryRefStore({
    versionDocumentId: 'version-doc-active-session-guards',
    now: () => CREATED_AT,
  });
  const main = refStore.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR });
  if (!main.ok) throw new Error(`expected main initialization: ${main.error.code}`);

  const branchService = createInMemoryBranchService({ refStore, headRefName: null });
  const session = {
    checkedOutCommitId: input.checkedOutCommitId,
    branchName: input.branchName,
    refHeadAtMaterialization: input.refHeadAtMaterialization,
    detached: false,
  };
  const surfaceStatusService = input.useLegacySessionReaderAlias
    ? { getActiveCheckoutSession: () => session }
    : { readActiveCheckoutSession: () => session };
  const version = new WorkbookVersionImpl({
    versioning: { branchService, surfaceStatusService },
  } as any);

  return { branchService, version };
}

function expectStaleActiveCheckoutFailure(
  result: VersionResult<VersionRef>,
  operation: BranchAdvanceMethod,
): void {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
          data: expect.objectContaining({
            mutationGuarantee: 'no-write-attempted',
            operation,
            recoverability: 'retry',
            payload: expect.objectContaining({ operation }),
          }),
        }),
      ],
    },
  });
}
