import { jest } from '@jest/globals';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { WorkbookConfig } from '../types';
import { WorkbookVersionImpl } from '../version';
import { createInMemoryBranchService } from '../../../document/version-store/branch-service';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
} from '../../../document/version-store/provider';
import { createInMemoryRefStore } from '../../../document/version-store/ref-store';
import { withVersionManifest } from './version-domain-support-test-utils';

const createCheckpointManagerMock = jest.fn();
const worksheetImplMock = jest.fn().mockImplementation((sheetId: string) => ({
  _sheetId: sheetId,
  _syncMetadata: jest.fn(),
  dispose: jest.fn(),
}));

jest.unstable_mockModule('../../worksheet/worksheet-impl', () => ({
  WorksheetImpl: worksheetImplMock,
}));

jest.unstable_mockModule('../../../services/checkpoint', () => ({
  createCheckpointManager: createCheckpointManagerMock,
}));

jest.unstable_mockModule('../../namespaces/records', () => ({
  get: jest.fn(),
  query: jest.fn(),
  getFieldValue: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  del: jest.fn(),
}));

jest.unstable_mockModule('../../../bridges/compute/compute-bridge', () => ({
  ComputeBridge: jest.fn(),
  createComputeBridge: jest.fn(),
  createComputeBridgeFromTransport: jest.fn(),
  extractMutationData: jest.fn(),
  identityFormulaToWire: jest.fn(),
  rustSchemaResolveEditor: jest.fn(),
  wireTableToTableConfig: jest.fn(),
  wireToIdentityFormula: jest.fn(),
  __esModule: true,
}));

const { WorkbookImpl } = await import('../workbook-impl');

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const AUX_COMMIT_ID =
  'commit:sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const SECRET_REF_NAME = 'scenario/provider-secret';
const SECRET_ISSUE = 'tenant-secret-issue-token';
const SECRET_OPTION = 'internal-secret-option';
const SECRET_CAUSE = 'postgres://secret-host/ref-conflict';
const SECRET_MESSAGE = `provider leaked ${SECRET_REF_NAME} ${SECRET_CAUSE}`;
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
type VersionGraphCommitSuccess = Extract<
  Awaited<ReturnType<VersionGraphStore['commit']>>,
  { readonly status: 'success' }
>;
type VersionGraphRefRevision = Extract<
  VersionGraphInitializeResult,
  { readonly status: 'success' }
>['initialHead']['revision'];

function createMockEventBus() {
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn().mockReturnValue(() => undefined),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {},
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    ...overrides,
  } as any;
}

function createWorkbook(overrides?: Partial<WorkbookConfig>) {
  createCheckpointManagerMock.mockReturnValue({
    create: jest.fn(),
    createSync: jest.fn(),
    restore: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  });

  const versioning = overrides?.versioning as Record<string, unknown> | undefined;
  return new WorkbookImpl({
    ctx: createMockCtx(),
    eventBus: createMockEventBus(),
    ...overrides,
    ...(versioning ? { versioning: withVersionManifest(versioning) } : {}),
  });
}

describe('WorkbookVersion provider-backed ref lifecycle W8 hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('serializes create, fast-forward, and delete CAS races across public provider facades', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const writer = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE, backend });
    const initialized = await writer.initializeGraph(await initializeInput('graph-cas-races'));
    expectInitializeSuccess(initialized);
    const graph = await writer.openGraph(
      namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-cas-races'),
    );
    const childA = await commitGraphChild(
      graph,
      'graph-cas-races',
      initialized.rootCommit.id,
      initialized.initialHead.revision,
      'race-child-a',
    );
    const childB = await commitGraphChild(
      graph,
      'graph-cas-races',
      childA.commit.id,
      childA.ref.revision,
      'race-child-b',
    );
    const wbA = createProviderWorkbook(backend);
    const wbB = createProviderWorkbook(backend);

    const createRace = expectOneSuccessOneFailure(
      await Promise.all([
        wbA.version.createBranch({
          name: 'scenario/cas-race' as any,
          targetCommitId: initialized.rootCommit.id,
        }),
        wbB.version.createBranch({
          name: 'scenario/cas-race' as any,
          targetCommitId: initialized.rootCommit.id,
        }),
      ]),
    );
    expect(createRace.success.value).toMatchObject({
      name: 'refs/heads/scenario/cas-race',
      commitId: initialized.rootCommit.id,
      revision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(createRace.failure, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });

    const advanceRace = expectOneSuccessOneFailure(
      await Promise.all([
        wbA.version.fastForwardBranch({
          name: 'scenario/cas-race' as any,
          nextCommitId: childA.commit.id,
          expectedHead: initialized.rootCommit.id,
          expectedRefRevision: { kind: 'counter', value: '0' },
        }),
        wbB.version.fastForwardBranch({
          name: 'refs/heads/scenario/cas-race' as any,
          nextCommitId: childB.commit.id,
          expectedHead: initialized.rootCommit.id,
          expectedRefRevision: { kind: 'counter', value: '0' },
        }),
      ]),
    );
    expect(advanceRace.success.value).toMatchObject({
      name: 'refs/heads/scenario/cas-race',
      revision: { kind: 'counter', value: '1' },
    });
    expectNoWriteFailure(advanceRace.failure, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });

    const deleteRace = expectOneSuccessOneFailure(
      await Promise.all([
        wbA.version.deleteRef({
          name: 'scenario/cas-race' as any,
          expectedHead: advanceRace.success.value.commitId,
          expectedRefRevision: { kind: 'counter', value: '1' },
        }),
        wbB.version.deleteBranch({
          name: 'refs/heads/scenario/cas-race' as any,
          expectedHead: advanceRace.success.value.commitId,
          expectedRefRevision: { kind: 'counter', value: '1' },
        }),
      ]),
    );
    expect(deleteRace.success.value).toMatchObject({
      name: 'refs/heads/scenario/cas-race',
      commitId: advanceRace.success.value.commitId,
      revision: { kind: 'counter', value: '2' },
    });
    expectNoWriteFailure(deleteRace.failure, 'VERSION_DANGLING_REF', {
      recoverability: 'unsupported',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(createRace.failure, 'scenario/cas-race');
    expectNoDiagnosticLeak(advanceRace.failure, 'scenario/cas-race');
    expectNoDiagnosticLeak(deleteRace.failure, 'scenario/cas-race');

    await expect(wbA.version.readRef('refs/heads/scenario/cas-race' as any)).resolves.toMatchObject(
      {
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_DANGLING_REF',
              data: expect.objectContaining({ redacted: true }),
            }),
          ],
        },
      },
    );
  });

  it('preserves provider tombstones across backend snapshot reloads', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const writer = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE, backend });
    const initialized = await writer.initializeGraph(
      await initializeInput('graph-tombstone-reload'),
    );
    expectInitializeSuccess(initialized);
    const wb = createProviderWorkbook(backend);

    await expect(
      wb.version.createBranch({
        name: 'scenario/reload-tombstone' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      wb.version.deleteRef({
        name: 'scenario/reload-tombstone' as any,
        expectedHead: initialized.rootCommit.id,
        expectedRefRevision: { kind: 'counter', value: '0' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/reload-tombstone',
        revision: { kind: 'counter', value: '1' },
      },
    });

    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(
      await backend.exportSnapshot(),
    );
    const reloadedWb = createProviderWorkbook(reloadedBackend);

    await expect(
      reloadedWb.version.readRef('refs/heads/scenario/reload-tombstone' as any),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DANGLING_REF',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });
    const listed = await reloadedWb.version.listRefs({ prefix: 'scenario' as any });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(`expected reloaded listRefs success: ${listed.error.code}`);
    expect(listed.value.items.map((ref) => ref.name)).not.toContain(
      'refs/heads/scenario/reload-tombstone',
    );

    const recreated = await reloadedWb.version.createBranch({
      name: 'scenario/reload-tombstone' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(recreated, 'VERSION_DANGLING_REF', {
      recoverability: 'unsupported',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(recreated, 'scenario/reload-tombstone');
  });

  it('rejects current HEAD deletes before invoking the provider tombstone writer', async () => {
    const branchName = 'scenario/current-head-delete';
    const refName = `refs/heads/${branchName}`;
    const branchService = {
      getHead: jest.fn(async () => ({
        ok: true,
        head: {
          mode: 'attached',
          refName,
          branchName,
          commitId: AUX_COMMIT_ID,
          refVersion: { kind: 'counter', value: '0' },
          refIncarnationId: 'inc-current-head-delete',
        },
        diagnostics: [],
      })),
      readBranch: jest.fn(),
      deleteBranch: jest.fn(),
    };
    const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

    const currentHeadDelete = await version.deleteRef({
      name: branchName as any,
      expectedHead: AUX_COMMIT_ID as any,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(currentHeadDelete, 'VERSION_REF_WRITE_UNAVAILABLE', {
      payload: expect.objectContaining({ issue: 'activeBranchDelete' }),
    });
    expectNoDiagnosticLeak(currentHeadDelete, branchName);
    expect(branchService.getHead).toHaveBeenCalledTimes(1);
    expect(branchService.readBranch).not.toHaveBeenCalled();
    expect(branchService.deleteBranch).not.toHaveBeenCalled();
  });

  it('rejects stale expected-head provider deletes before tombstone writes', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-stale-delete'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(
      namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-stale-delete'),
    );
    const child = await commitGraphChild(
      graph,
      'graph-stale-delete',
      initialized.rootCommit.id,
      initialized.initialHead.revision,
      'stale-delete-child',
    );
    const wb = createWorkbook({ versioning: { provider } });

    await expect(
      wb.version.createBranch({
        name: 'scenario/stale-delete-head' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      wb.version.fastForwardBranch({
        name: 'scenario/stale-delete-head' as any,
        nextCommitId: child.commit.id,
        expectedHead: initialized.rootCommit.id,
        expectedRefRevision: { kind: 'counter', value: '0' },
      }),
    ).resolves.toMatchObject({ ok: true });

    const deleteBranch = jest.spyOn(graph, 'deleteBranch');
    const stale = await wb.version.deleteRef({
      name: 'scenario/stale-delete-head' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: { kind: 'counter', value: '1' },
    });
    expectNoWriteFailure(stale, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
        conflict: 'expectedHeadMismatch',
      }),
    });
    expectNoDiagnosticLeak(stale, 'scenario/stale-delete-head');
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it('rejects malformed delete ref names with redacted stable reasons before provider calls', async () => {
    const branchService = {
      readBranch: jest.fn(),
      deleteBranch: jest.fn(),
    };
    const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);
    const malformedRefName = 'Scenario/Provider-Secret';

    const malformed = await version.deleteRef({
      name: malformedRefName as any,
      expectedHead: AUX_COMMIT_ID as any,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(malformed, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({
        issue: 'containsUppercase',
        refName: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(malformed, malformedRefName, 'Provider-Secret');
    expect(branchService.readBranch).not.toHaveBeenCalled();
    expect(branchService.deleteBranch).not.toHaveBeenCalled();
  });

  it.each([
    ['returned', async () => providerDeniedFailure()],
    [
      'thrown',
      async () => {
        throw providerDeniedFailure();
      },
    ],
  ])(
    'redacts %s provider delete denials with a stable reason',
    async (_label, deleteBranchImpl) => {
      const branchService = {
        readBranch: jest.fn(async () => ({
          ok: true,
          branch: {
            name: SECRET_REF_NAME,
            ref: {
              targetCommitId: AUX_COMMIT_ID,
              refVersion: { kind: 'counter', value: '0' },
            },
          },
          diagnostics: [],
        })),
        deleteBranch: jest.fn(deleteBranchImpl),
      };
      const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

      const denied = await version.deleteRef({
        name: SECRET_REF_NAME as any,
        expectedHead: AUX_COMMIT_ID as any,
        expectedRefRevision: { kind: 'counter', value: '0' },
      });
      expectNoWriteFailure(denied, 'VERSION_PERMISSION_DENIED', {
        recoverability: 'unsupported',
        payload: expect.objectContaining({
          conflict: 'redacted',
          issue: 'providerDenied',
        }),
      });
      expectNoDiagnosticLeak(denied, SECRET_REF_NAME, SECRET_CAUSE, SECRET_MESSAGE);
      expect(branchService.readBranch).toHaveBeenCalledTimes(1);
      expect(branchService.deleteBranch).toHaveBeenCalledTimes(1);
    },
  );

  it('redacts unknown provider diagnostic detail tokens for create and delete failures', async () => {
    const branchService = {
      createBranch: jest.fn(async () => unsafeProviderFailure('createBranch')),
      deleteBranch: jest.fn(async () => unsafeProviderFailure('deleteBranch')),
    };
    const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

    const createFailed = await version.createBranch({
      name: SECRET_REF_NAME as any,
      targetCommitId: AUX_COMMIT_ID as any,
    });
    expectNoWriteFailure(createFailed, 'VERSION_REF_WRITE_UNAVAILABLE', {
      payload: expect.objectContaining({
        conflict: 'redacted',
        issue: 'redacted',
        option: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(
      createFailed,
      SECRET_REF_NAME,
      SECRET_ISSUE,
      SECRET_OPTION,
      SECRET_CAUSE,
      SECRET_MESSAGE,
    );

    const deleteFailed = await version.deleteRef({
      name: SECRET_REF_NAME as any,
      expectedHead: AUX_COMMIT_ID as any,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(deleteFailed, 'VERSION_REF_WRITE_UNAVAILABLE', {
      payload: expect.objectContaining({
        conflict: 'redacted',
        issue: 'redacted',
        option: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(
      deleteFailed,
      SECRET_REF_NAME,
      SECRET_ISSUE,
      SECRET_OPTION,
      SECRET_CAUSE,
      SECRET_MESSAGE,
    );
    expect(branchService.createBranch).toHaveBeenCalledTimes(1);
    expect(branchService.deleteBranch).toHaveBeenCalledTimes(1);
  });

  it('projects tombstone incarnation mismatches as redacted create CAS conflicts', async () => {
    const branchService = {
      createBranch: jest.fn(async () => ({
        ok: false,
        diagnostics: [
          {
            code: 'expectedPreviousRefIncarnationIdMismatch',
            severity: 'error',
            message: SECRET_MESSAGE,
            commitId: AUX_COMMIT_ID,
            tombstoneRefVersion: { kind: 'counter', value: '4' },
            previousRefIncarnationId: 'secret-previous-incarnation',
            details: { expectedPreviousRefIncarnationId: 'secret-expected-incarnation' },
          },
        ],
      })),
    };
    const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

    const conflict = await version.createBranch({
      name: SECRET_REF_NAME as any,
      targetCommitId: AUX_COMMIT_ID as any,
    });
    expectNoWriteFailure(conflict, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
        conflict: 'expectedPreviousRefIncarnationIdMismatch',
      }),
    });
    expectNoDiagnosticLeak(
      conflict,
      SECRET_REF_NAME,
      SECRET_MESSAGE,
      'secret-previous-incarnation',
      'secret-expected-incarnation',
    );
  });

  it.each([
    ['pending', { status: 'pending' }, 'activeCheckoutSessionPending'],
    [
      'failed',
      { status: 'failed', diagnostics: [unsafeProviderFailure('activeRef')] },
      'activeCheckoutSessionFailed',
    ],
  ])(
    'fails closed for %s active-ref provider reads before delete preflight',
    async (_label, active, _phase) => {
      const branchService = {
        readActiveCheckoutSession: jest.fn(async () => active),
        readBranch: jest.fn(),
        deleteBranch: jest.fn(),
      };
      const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

      const blocked = await version.deleteRef({
        name: SECRET_REF_NAME as any,
        expectedHead: AUX_COMMIT_ID as any,
        expectedRefRevision: { kind: 'counter', value: '0' },
      });
      expectNoWriteFailure(blocked, 'VERSION_PROVIDER_ERROR', {
        recoverability: 'retry',
        payload: expect.objectContaining({ phase: 'redacted' }),
      });
      expectNoDiagnosticLeak(blocked, SECRET_REF_NAME, SECRET_MESSAGE);
      expect(branchService.readBranch).not.toHaveBeenCalled();
      expect(branchService.deleteBranch).not.toHaveBeenCalled();
    },
  );
});

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label: graphId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        changes: [],
        label: graphId,
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function commitGraphChild(
  graph: VersionGraphStore,
  graphId: string,
  parentCommitId: string,
  expectedMainRefVersion: VersionGraphRefRevision,
  label: string,
): Promise<VersionGraphCommitSuccess> {
  const childInput = await initializeInput(graphId);
  const child = await graph.commit({
    ...childInput.rootWrite,
    snapshotRootRecord: await objectRecord(graph.namespace, 'workbook.snapshotRoot.v1', {
      label,
      parent: parentCommitId,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(graph.namespace, 'workbook.semanticChangeSet.v1', {
      changes: [{ id: `${label}-change`, domain: 'test' }],
      label,
    }),
    expectedHeadCommitId: parentCommitId,
    expectedMainRefVersion,
  });
  expect(child.status).toBe('success');
  if (child.status !== 'success') {
    throw new Error(`expected child graph commit: ${child.diagnostics[0]?.code}`);
  }
  return child;
}

function createProviderWorkbook(backend: InMemoryVersionDocumentProviderBackend) {
  return createWorkbook({
    versioning: {
      provider: createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE, backend }),
    },
  });
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function expectOneSuccessOneFailure(results: readonly any[]) {
  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  expect(successes).toHaveLength(1);
  expect(failures).toHaveLength(1);
  if (!successes[0]?.ok || failures[0]?.ok !== false) {
    throw new Error('expected exactly one success and one failure');
  }
  return { success: successes[0], failure: failures[0] };
}

function expectNoWriteFailure(
  result: unknown,
  code: string,
  data: Readonly<Record<string, unknown>> = {},
): void {
  expect(result).toMatchObject({
    ok: false,
    error: {
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code,
          data: expect.objectContaining({
            redacted: true,
            mutationGuarantee: 'no-write-attempted',
            ...data,
          }),
        }),
      ]),
    },
  });
}

function expectNoDiagnosticLeak(result: unknown, ...secrets: readonly string[]): void {
  const serialized = JSON.stringify(result) ?? '';
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
}

function unsafeProviderFailure(operation: string) {
  const diagnostics = [
    {
      code: 'versionCapabilityDisabled',
      severity: 'error',
      message: SECRET_MESSAGE,
      refName: SECRET_REF_NAME,
      details: {
        cause: SECRET_CAUSE,
        issue: SECRET_ISSUE,
        missingField: SECRET_OPTION,
        mutationGuarantee: 'no-write-attempted',
        operation,
      },
    },
  ];
  return {
    ok: false,
    error: {
      code: 'versionCapabilityDisabled',
      message: SECRET_MESSAGE,
      diagnostics,
    },
    diagnostics,
  };
}

function providerDeniedFailure() {
  const diagnostics = [
    {
      code: 'VERSION_PERMISSION_DENIED',
      severity: 'error',
      message: SECRET_MESSAGE,
      refName: SECRET_REF_NAME,
      details: {
        cause: SECRET_CAUSE,
        issue: 'providerDenied',
        mutationGuarantee: 'no-write-attempted',
      },
    },
  ];
  return {
    ok: false,
    error: {
      code: 'VERSION_PERMISSION_DENIED',
      message: SECRET_MESSAGE,
      diagnostics,
    },
    diagnostics,
  };
}
