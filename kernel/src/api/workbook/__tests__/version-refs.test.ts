import { createInMemoryRefStore } from '../../../document/version-store/ref-store';
import { WorkbookVersionImpl } from '../version';
import {
  AUTHOR,
  COMMIT_A,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';

describe('WorkbookVersion public ref lifecycle facade', () => {
  it('fails closed when no branch service is attached', async () => {
    const version = new WorkbookVersionImpl({ versioning: {} } as any);

    await expect(version.listRefs()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });

    await expect(
      version.createBranch({ name: 'scenario/missing' as any, targetCommitId: COMMIT_A }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });

    await expect(
      version.deleteRef({
        name: 'scenario/missing' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });
  });

  it('creates, reads, gets, and lists public branch refs through the attached service', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();

    await expect(
      version.createBranch({
        name: 'scenario/budget' as any,
        targetCommitId: COMMIT_A,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        name: 'refs/heads/scenario/budget',
        commitId: COMMIT_A,
        revision: refVersion('0'),
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
    });

    await expect(version.readRef('refs/heads/scenario/budget' as any)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'refs/heads/scenario/budget',
          commitId: COMMIT_A,
          revision: refVersion('0'),
        },
      },
    });

    await expect(version.getRef('scenario/budget' as any)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'refs/heads/scenario/budget',
          commitId: COMMIT_A,
        },
      },
    });

    await expect(version.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/main',
          revision: refVersion('0'),
        },
        diagnostics: [],
      },
    });

    await expect(version.listRefs()).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({ name: 'refs/heads/main', commitId: COMMIT_A }),
          expect.objectContaining({ name: 'refs/heads/scenario/budget', commitId: COMMIT_A }),
        ],
        limit: 50,
      },
    });

    expect(branchService.readBranch('scenario/budget')).toMatchObject({
      ok: true,
      branch: {
        name: 'scenario/budget',
      },
    });
  });

  it('reports symbolic HEAD from the attached branch service target', async () => {
    const { version } = createWorkbookVersionWithBranchService('scenario/attached');
    await version.createBranch({ name: 'scenario/attached' as any, targetCommitId: COMMIT_A });

    await expect(version.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/scenario/attached',
          revision: refVersion('0'),
        },
        diagnostics: [],
      },
    });
  });

  it('filters listRefs by namespace only without mutating state', async () => {
    const { version } = createWorkbookVersionWithBranchService();

    await version.createBranch({ name: 'scenario/budget' as any, targetCommitId: COMMIT_A });
    await version.createBranch({ name: 'scenario/forecast/q1' as any, targetCommitId: COMMIT_A });
    await version.createBranch({ name: 'agent/run-1' as any, targetCommitId: COMMIT_A });

    const scenarioRefs = await version.listRefs({ prefix: 'scenario' as any });
    expect(scenarioRefs.ok).toBe(true);
    if (!scenarioRefs.ok) throw new Error(`expected listRefs success: ${scenarioRefs.error.code}`);
    expect(scenarioRefs.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'refs/heads/scenario/budget' }),
        expect.objectContaining({ name: 'refs/heads/scenario/forecast/q1' }),
      ]),
    );
    expect(scenarioRefs.value.items).toHaveLength(2);

    const fullNamespaceRefs = await version.listRefs({ prefix: 'refs/heads/scenario' as any });
    expect(fullNamespaceRefs).toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({ name: 'refs/heads/scenario/budget' }),
          expect.objectContaining({ name: 'refs/heads/scenario/forecast/q1' }),
        ],
        limit: 50,
      },
    });
    expect(fullNamespaceRefs.ok && fullNamespaceRefs.value.items).toHaveLength(2);

    await expect(
      version.listRefs({ prefix: 'refs/heads/scenario/forecast' as any }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({ option: 'prefix' }),
            }),
          }),
        ],
      },
    });

    const allRefs = await version.listRefs();
    expect(allRefs.ok).toBe(true);
    if (!allRefs.ok) throw new Error(`expected listRefs success: ${allRefs.error.code}`);
    expect(allRefs.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'refs/heads/main' }),
        expect.objectContaining({ name: 'refs/heads/agent/run-1' }),
        expect.objectContaining({ name: 'refs/heads/scenario/budget' }),
        expect.objectContaining({ name: 'refs/heads/scenario/forecast/q1' }),
      ]),
    );
    expect(allRefs.value.items).toHaveLength(4);
    expect(allRefs.value.limit).toBe(50);
  });

  it('does not treat a raw ref store as a trusted public branch service', async () => {
    const refStore = createInMemoryRefStore({
      versionDocumentId: 'version-doc-1',
      now: () => '2026-06-20T00:00:00.000Z',
    });
    const main = refStore.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR });
    expect(main.ok).toBe(true);

    const version = new WorkbookVersionImpl({
      versioning: { refStore },
    } as any);

    await expect(version.listRefs()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });
  });
});
