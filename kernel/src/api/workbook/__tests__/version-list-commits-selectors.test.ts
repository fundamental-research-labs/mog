import { jest } from '@jest/globals';

import {
  CHILD_COMMIT_ID,
  CREATED_AT,
  PAGE_TOKEN,
  PUBLIC_LIST_PAGE_TOKEN,
  REF_REVISION,
  ROOT_COMMIT_ID,
  createFakeGraphStore,
  createVersion,
  rootCommitSummary,
  successPage,
} from './version-list-commits-selectors-test-utils';
import {
  createWorkbookVersionSurfaceStatusService,
} from '../version/surface-status/version-surface-status-service';

const ACTIVE_BRANCH_REF = 'refs/heads/scenario/list-active-revert' as const;

describe('WorkbookVersion listCommits selector forwarding', () => {
  it('forwards public ref and commit roots without leaking unsupported options to the graph service', async () => {
    const graphStore = createFakeGraphStore();
    graphStore.listCommits
      .mockResolvedValueOnce(successPage())
      .mockResolvedValueOnce(successPage())
      .mockResolvedValueOnce(successPage({ commits: [rootCommitSummary()] }))
      .mockResolvedValueOnce(successPage())
      .mockResolvedValueOnce(successPage());
    const version = createVersion(graphStore);

    await expect(version.listCommits({ ref: 'refs/heads/main', pageSize: 2 })).resolves.toEqual({
      ok: true,
      value: {
        items: [
          {
            id: CHILD_COMMIT_ID,
            parents: [ROOT_COMMIT_ID],
            createdAt: CREATED_AT,
            author: {
              actorKind: 'user',
              displayName: 'Public Reader',
              redacted: true,
            },
          },
          {
            id: ROOT_COMMIT_ID,
            parents: [],
            createdAt: CREATED_AT,
            author: {
              actorKind: 'system',
              redacted: true,
            },
          },
        ],
        limit: 2,
      },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({
      ref: 'refs/heads/main',
      pageSize: 2,
    });

    await expect(version.listCommits({ ref: 'HEAD' })).resolves.toMatchObject({
      ok: true,
      value: { limit: 50 },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ ref: 'HEAD' });

    await expect(
      version.listCommits({ from: ROOT_COMMIT_ID, includeDiagnostics: true }),
    ).resolves.toMatchObject({
      ok: true,
      value: { limit: 50 },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ from: ROOT_COMMIT_ID });

    await expect(version.listCommits({ pageToken: PAGE_TOKEN })).resolves.toMatchObject({
      ok: true,
      value: { limit: 50 },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ pageToken: PAGE_TOKEN });

    await expect(version.listCommits({ pageToken: PUBLIC_LIST_PAGE_TOKEN })).resolves.toMatchObject(
      {
        ok: true,
        value: { limit: 50 },
      },
    );
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({
      pageToken: PUBLIC_LIST_PAGE_TOKEN,
    });
  });

  it('uses the active checkout branch as the implicit commit list root', async () => {
    const graphStore = createFakeGraphStore();
    graphStore.listCommits.mockResolvedValueOnce(successPage());
    const surfaceStatusService = createCleanSurfaceStatusService();
    surfaceStatusService.recordActiveCheckoutBranchCommit({
      commitId: CHILD_COMMIT_ID,
      refName: ACTIVE_BRANCH_REF,
    });
    const readRef = jest.fn(async () => ({
      status: 'success',
      ref: { name: ACTIVE_BRANCH_REF, commitId: CHILD_COMMIT_ID, revision: REF_REVISION },
    }));
    const version = createVersion(graphStore, {
      readService: { readRef },
      surfaceStatusService,
    });

    await expect(version.listCommits()).resolves.toMatchObject({
      ok: true,
      value: { limit: 50 },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ ref: ACTIVE_BRANCH_REF });
    expect(readRef).toHaveBeenCalledWith(ACTIVE_BRANCH_REF);
  });

  it('uses the detached checkout commit as the implicit commit list root', async () => {
    const graphStore = createFakeGraphStore();
    graphStore.listCommits.mockResolvedValueOnce(successPage());
    const surfaceStatusService = createCleanSurfaceStatusService();
    surfaceStatusService.recordCheckoutMaterialization({
      commitId: CHILD_COMMIT_ID,
      resolvedTarget: { kind: 'commit', commitId: CHILD_COMMIT_ID },
    } as never);
    const version = createVersion(graphStore, { surfaceStatusService });

    await expect(version.listCommits({ ref: 'HEAD' })).resolves.toMatchObject({
      ok: true,
      value: { limit: 50 },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ from: CHILD_COMMIT_ID });
  });
});

function createCleanSurfaceStatusService() {
  return createWorkbookVersionSurfaceStatusService({
    readDirtyState: () => ({
      hasUncommittedLocalChanges: false,
      calculationState: 'done',
      checkoutInProgress: false,
      revision: 0,
      contextGeneration: 0,
    }),
  });
}
