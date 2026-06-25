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
import { createWorkbookVersionSurfaceStatusService } from '../version/surface-status/version-surface-status-service';

const ACTIVE_BRANCH_REF = 'refs/heads/scenario/list-active-revert' as const;

describe('WorkbookVersion listCommits selector forwarding', () => {
  it('forwards public ref and commit roots without leaking unsupported options to the graph service', async () => {
    const graphStore = createFakeGraphStore();
    graphStore.listCommits
      .mockResolvedValueOnce(
        successPage({
          commits: [
            {
              ...rootCommitSummary(),
              parents: [ROOT_COMMIT_ID],
              id: CHILD_COMMIT_ID,
              author: {
                authorId: 'agent-1',
                actorKind: 'agent',
                displayName: 'Public Reader',
                clientId: 'hidden-client',
                principalId: 'protected-principal',
                agentRunId: 'opaque-agent-run',
              },
              annotation: {
                title: { kind: 'text', value: 'protected salary details' },
                message: { kind: 'text', value: 'deleted acquisition plan' },
                tags: [{ kind: 'text', value: 'opaque finance blob' }],
              },
            },
            {
              ...rootCommitSummary(),
              annotation: {
                title: { kind: 'redacted', reason: 'permission-denied' },
              },
            },
          ],
        }),
      )
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
              actorKind: 'agent',
              displayName: 'Public Reader',
              redacted: true,
            },
            annotation: {
              title: { kind: 'text', value: 'protected salary details' },
              message: { kind: 'text', value: 'deleted acquisition plan' },
              tags: [{ kind: 'text', value: 'opaque finance blob' }],
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
            annotation: {
              title: { kind: 'redacted', reason: 'permission-denied' },
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

  it('rejects reserved branch ref namespaces before provider dispatch', async () => {
    const graphStore = createFakeGraphStore();
    const version = createVersion(graphStore);

    await expect(
      version.listCommits({
        ref: 'refs/heads/hidden/vc08_hidden_ref_payroll_shadow',
        includeDiagnostics: true,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.listCommits',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({
                option: 'ref',
                refName: 'redacted',
              }),
            }),
          }),
        ],
      },
    });
    expect(graphStore.listCommits).not.toHaveBeenCalled();
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
