import { jest } from '@jest/globals';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { WorkbookConfig } from '../types';
import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
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

describe('WorkbookVersion provider-backed ref lifecycle facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes public branch refs through the provider-attached lifecycle service', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const childInput = await initializeInput('graph-1', 'branch-target');
    const child = await graph.commit({
      ...childInput.rootWrite,
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
    });
    expect(child.status).toBe('success');
    if (child.status !== 'success') {
      throw new Error(`expected child graph commit: ${child.diagnostics[0]?.code}`);
    }

    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/provider-ref' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/provider-ref',
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
    });

    await expect(
      wb.version.readRef('refs/heads/scenario/provider-ref' as any),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'refs/heads/scenario/provider-ref',
          commitId: initialized.rootCommit.id,
          revision: { kind: 'counter', value: '0' },
        },
        diagnostics: [],
      },
    });

    await expect(wb.version.listRefs({ prefix: 'scenario' as any })).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            name: 'refs/heads/scenario/provider-ref',
            commitId: initialized.rootCommit.id,
          }),
        ],
        limit: 50,
      },
    });

    await expect(
      wb.version.listRefs({ prefix: 'refs/heads/scenario/provider' as any }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
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

    await expect(
      wb.version.fastForwardBranch({
        name: 'scenario/provider-ref' as any,
        nextCommitId: child.commit.id,
        expectedHead: initialized.rootCommit.id,
        expectedRefRevision: { kind: 'counter', value: '0' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/provider-ref',
        commitId: child.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });

    const status = await wb.version.getStatus();
    expect(status.refLifecycleFoundation).toMatchObject({
      stage: 'present',
      available: true,
      diagnostics: [expect.objectContaining({ code: 'version.refLifecycle.foundationPresent' })],
    });
  });

  it('fails closed for branch writes when the provider is read-only', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const writer = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
    });
    const initialized = await writer.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      readOnly: true,
    });
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(wb.version.listRefs()).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            name: 'refs/heads/main',
            commitId: initialized.rootCommit.id,
          }),
        ],
        limit: 50,
      },
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/read-only' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });

    await expect(wb.version.listRefs({ prefix: 'scenario' as any })).resolves.toMatchObject({
      ok: true,
      value: {
        items: [],
        limit: 50,
      },
    });
  });

  it.each([
    ['branch name', 'scenario/provider-commit'],
    ['full ref', 'refs/heads/scenario/provider-commit'],
  ])(
    'commits public targetRef writes by %s to the provider-backed branch without advancing main',
    async (_label, targetRef) => {
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
      expectInitializeSuccess(initialized);
      const captureNormalCommit = jest.fn(createNormalCommitCapture('branch-child'));
      const wb = createWorkbook({
        versioning: {
          provider,
          captureNormalCommit,
        },
      });

      await expect(
        wb.version.createBranch({
          name: 'scenario/provider-commit' as any,
          targetCommitId: initialized.rootCommit.id,
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          name: 'refs/heads/scenario/provider-commit',
          commitId: initialized.rootCommit.id,
          revision: { kind: 'counter', value: '0' },
        },
      });

      const committed = await wb.version.commit({
        targetRef: targetRef as any,
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: { kind: 'counter', value: '0' },
        },
      });

      expect(captureNormalCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          currentRef: expect.objectContaining({
            name: 'refs/heads/scenario/provider-commit',
            commitId: initialized.rootCommit.id,
          }),
          currentMain: expect.objectContaining({
            name: 'refs/heads/main',
            commitId: initialized.rootCommit.id,
          }),
          options: expect.objectContaining({
            targetRef: 'refs/heads/scenario/provider-commit',
          }),
        }),
      );
      expect(committed).toMatchObject({
        ok: true,
        value: {
          parents: [initialized.rootCommit.id],
          createdAt: CREATED_AT,
          author: { actorKind: 'user', displayName: 'User One', redacted: true },
        },
      });
      if (!committed.ok) throw new Error(`expected commit success: ${committed.error.code}`);
      expect(committed.value.id).not.toBe(initialized.rootCommit.id);

      await expect(
        wb.version.readRef('refs/heads/scenario/provider-commit' as any),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/scenario/provider-commit',
            commitId: committed.value.id,
            revision: { kind: 'counter', value: '1' },
          },
        },
      });
      await expect(wb.version.readRef('refs/heads/main')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/main',
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
          },
        },
      });
      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: initialized.rootCommit.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: initialized.symbolicHead.revision,
        },
      });
    },
  );

  it('rejects symbolic HEAD revisions for explicit targetRef commits before capture', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const captureNormalCommit = jest.fn(createNormalCommitCapture('should-not-run'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    await expect(
      wb.version.commit({
        targetRef: 'scenario/provider-commit' as any,
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                option: 'expectedHead.symbolicHeadRevision',
              }),
              redacted: true,
            }),
          }),
        ],
      },
    });
    expect(captureNormalCommit).not.toHaveBeenCalled();
  });
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

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function createNormalCommitCapture(label: string): VersionNormalCommitCapture {
  return async ({ namespace, currentRef }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentRef.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [{ id: `${label}-change-1`, domain: 'test' }],
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentRef.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
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
