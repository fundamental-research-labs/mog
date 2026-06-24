import { createInMemoryBranchService } from '../../../document/version-store/branch-service';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { createInMemoryRefStore } from '../../../document/version-store/refs/ref-store';
import { WorkbookVersionImpl } from '../version';
import {
  AUX_COMMIT_ID,
  CREATED_AT,
  DOCUMENT_SCOPE,
  VERSION_AUTHOR,
  createWorkbook,
  expectInitializeSuccess,
  expectNoWriteFailure,
  initializeInput,
  resetWorkbookProviderTestMocks,
} from './version-refs-provider-w8-test-utils';

describe('WorkbookVersion provider-backed ref lifecycle W8 listing and HEAD', () => {
  beforeEach(() => {
    resetWorkbookProviderTestMocks();
  });

  it('returns provider listRefs in deterministic public order with stable page metadata', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-refs-order'));
    expectInitializeSuccess(initialized);
    const wb = createWorkbook({ versioning: { provider } });

    for (const name of [
      'scenario/zeta',
      'review/open',
      'agent/sync',
      'scenario/alpha',
      'import/xlsx',
    ]) {
      await expect(
        wb.version.createBranch({
          name: name as any,
          targetCommitId: initialized.rootCommit.id,
        }),
      ).resolves.toMatchObject({ ok: true });
    }

    const allRefs = await wb.version.listRefs();
    expect(allRefs.ok).toBe(true);
    if (!allRefs.ok) throw new Error(`expected listRefs success: ${allRefs.error.code}`);
    expect(allRefs.value.limit).toBe(50);
    expect(allRefs.value.items.map((ref) => ref.name)).toEqual([
      'refs/heads/agent/sync',
      'refs/heads/import/xlsx',
      'refs/heads/main',
      'refs/heads/review/open',
      'refs/heads/scenario/alpha',
      'refs/heads/scenario/zeta',
    ]);

    const scenarioRefs = await wb.version.listRefs({ prefix: 'refs/heads/scenario' as any });
    expect(scenarioRefs.ok).toBe(true);
    if (!scenarioRefs.ok) {
      throw new Error(`expected scenario listRefs success: ${scenarioRefs.error.code}`);
    }
    expect(scenarioRefs.value.limit).toBe(50);
    expect(scenarioRefs.value.items.map((ref) => ref.name)).toEqual([
      'refs/heads/scenario/alpha',
      'refs/heads/scenario/zeta',
    ]);
  });

  it('reports symbolic HEAD rebinding from attached branch lifecycle services', async () => {
    const refStore = createInMemoryRefStore({
      versionDocumentId: 'version-doc-head-rebind',
      now: () => CREATED_AT,
    });
    const main = refStore.initializeMain({
      targetCommitId: AUX_COMMIT_ID,
      createdBy: VERSION_AUTHOR,
    });
    expect(main.ok).toBe(true);
    if (!main.ok) throw new Error(`expected main initialization: ${main.error.code}`);

    const writer = createInMemoryBranchService({ refStore });
    const branch = writer.createBranch({
      name: 'scenario/head-rebound',
      targetCommitId: AUX_COMMIT_ID,
      expectedAbsent: true,
      createdBy: VERSION_AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    const mainHeadVersion = new WorkbookVersionImpl({
      versioning: { branchService: createInMemoryBranchService({ refStore }) },
    } as any);
    await expect(mainHeadVersion.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/main',
          revision: { kind: 'counter', value: '0' },
        },
        diagnostics: [],
      },
    });

    const reboundHeadVersion = new WorkbookVersionImpl({
      versioning: {
        branchService: createInMemoryBranchService({
          refStore,
          headRefName: 'scenario/head-rebound',
        }),
      },
    } as any);
    await expect(reboundHeadVersion.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/scenario/head-rebound',
          revision: { kind: 'counter', value: '0' },
        },
        diagnostics: [],
      },
    });

    const activeDelete = await reboundHeadVersion.deleteRef({
      name: 'scenario/head-rebound' as any,
      expectedHead: AUX_COMMIT_ID as any,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(activeDelete, 'VERSION_REF_WRITE_UNAVAILABLE', {
      payload: expect.objectContaining({ issue: 'activeBranchDelete' }),
    });
  });
});
