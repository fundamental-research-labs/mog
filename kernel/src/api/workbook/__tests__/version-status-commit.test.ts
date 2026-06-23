import { jest } from '@jest/globals';

import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import {
  VERSION_STATUS_CHILD_COMMIT_ID as CHILD_COMMIT_ID,
  VERSION_STATUS_CREATED_AT as CREATED_AT,
  VERSION_STATUS_REF_REVISION as REF_REVISION,
  VERSION_STATUS_ROOT_COMMIT_ID as ROOT_COMMIT_ID,
  createFakeVersionStatusGraphStore as createFakeGraphStore,
} from './version-status-test-utils';
import {
  DOCUMENT_SCOPE,
  VERSION_AUTHOR,
  createEmptyNormalCommitCapture,
  createMockCtx,
  createNormalCommitCapture,
  createWorkbook,
  expectInitializeSuccess,
  initializeInput,
  resetVersionStatusWorkbookMocks,
} from './version-status-workbook-test-utils';

describe('WorkbookVersion status commit APIs', () => {
  beforeEach(() => {
    resetVersionStatusWorkbookMocks();
  });

  it('maps public commit options to an attached version write service', async () => {
    const commit = jest.fn(async () => ({
      status: 'success',
      summary: {
        id: CHILD_COMMIT_ID,
        parents: [ROOT_COMMIT_ID],
        createdAt: CREATED_AT,
        author: VERSION_AUTHOR,
      },
    }));
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          objectStore: {},
          refStore: {},
          writeService: { commit },
        },
      }),
    });

    await expect(
      wb.version.commit({
        message: 'Capture forecast edits',
        mode: { kind: 'normal' },
        expectedHead: {
          commitId: ROOT_COMMIT_ID,
          revision: REF_REVISION,
          symbolicHeadRevision: { kind: 'opaque', value: 'head-rev-1' },
        },
        redactionPolicy: {
          mode: 'strict',
          redactSecrets: true,
          redactExternalLinks: true,
          redactAgentTrace: true,
        },
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        id: CHILD_COMMIT_ID,
        parents: [ROOT_COMMIT_ID],
        createdAt: CREATED_AT,
        author: { actorKind: 'user', displayName: 'User One', redacted: true },
      },
    });
    expect(commit).toHaveBeenCalledWith({
      message: 'Capture forecast edits',
      mode: { kind: 'normal' },
      expectedHead: {
        commitId: ROOT_COMMIT_ID,
        revision: REF_REVISION,
        symbolicHeadRevision: { kind: 'opaque', value: 'head-rev-1' },
      },
      redactionPolicy: {
        mode: 'strict',
        redactSecrets: true,
        redactExternalLinks: true,
        redactAgentTrace: true,
      },
    });

    await expect(wb.version.getStatus()).resolves.toMatchObject({
      commitApi: {
        stage: 'present',
        available: true,
      },
    });
  });

  it('routes public commit through the attached provider-backed normal commit service', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const captureNormalCommit = jest.fn(createNormalCommitCapture('child'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    const committedResult = await wb.version.commit({
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
        symbolicHeadRevision: initialized.symbolicHead.revision,
      },
    });
    if (!committedResult.ok) {
      throw new Error(`expected provider-backed commit success: ${committedResult.error.code}`);
    }
    const committed = committedResult.value;

    expect(captureNormalCommit).toHaveBeenCalledTimes(1);
    expect(committed).toMatchObject({
      parents: [initialized.rootCommit.id],
      createdAt: CREATED_AT,
      author: { actorKind: 'user', displayName: 'User One', redacted: true },
    });
    expect(committed.id).not.toBe(initialized.rootCommit.id);

    await expect(wb.version.getHead()).resolves.toMatchObject({
      ok: true,
      value: {
        id: committed.id,
        refName: VERSION_GRAPH_MAIN_REF,
        resolvedFrom: 'HEAD',
        refRevision: { kind: 'counter', value: '1' },
      },
    });
    await expect(wb.version.listCommits()).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({ id: committed.id, parents: [initialized.rootCommit.id] }),
          expect.objectContaining({ id: initialized.rootCommit.id, parents: [] }),
        ],
        limit: 50,
      },
    });
    const status = await wb.version.getStatus();
    expect(status.checkout).toMatchObject({ stage: 'present', available: true });
    expect(status.checkout.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'version.checkout.serviceAttached',
    ]);

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readHead()).resolves.toMatchObject({
      status: 'success',
      head: {
        id: committed.id,
        refRevision: { kind: 'counter', value: '1' },
      },
    });
  });

  it('returns graph-uninitialized diagnostics before capture when provider registry is absent', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const captureNormalCommit = jest.fn(createNormalCommitCapture('should-not-run'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_GRAPH_UNINITIALIZED',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              redacted: true,
            }),
          }),
        ],
      },
    });
    expect(captureNormalCommit).not.toHaveBeenCalled();
  });

  it('rejects empty normal capture without advancing the initialized main ref', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const captureNormalCommit = jest.fn(createEmptyNormalCommitCapture('empty'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_CHANGE_SET',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              redacted: true,
            }),
          }),
        ],
      },
    });
    expect(captureNormalCommit).toHaveBeenCalledTimes(1);

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readHead()).resolves.toMatchObject({
      status: 'success',
      head: {
        id: initialized.rootCommit.id,
        refRevision: initialized.initialHead.revision,
      },
    });
  });

  it.each([
    ['author', 'VERSION_PERMISSION_DENIED'],
    ['parents', 'VERSION_PERMISSION_DENIED'],
    ['segmentIds', 'VERSION_INVALID_OPTIONS'],
    ['unknownField', 'VERSION_INVALID_OPTIONS'],
  ])('rejects unsafe commit option %s before the write service is called', async (field, issue) => {
    const commit = jest.fn();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          writeService: { commit },
        },
      }),
    });

    await expect(wb.version.commit({ [field]: 'spoofed' } as any)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: issue,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              redacted: true,
            }),
          }),
        ],
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects unsupported root/import commit modes before the write service is called', async () => {
    const commit = jest.fn();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          writeService: { commit },
        },
      }),
    });

    await expect(wb.version.commit({ mode: { kind: 'root' } })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' })],
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not treat a raw graph store commit method as the public write service', async () => {
    const graphStore = {
      ...createFakeGraphStore(),
      initializeGraph: jest.fn(),
      readCommitClosure: jest.fn(),
      commit: jest.fn(),
    };
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });
    expect(graphStore.commit).not.toHaveBeenCalled();
  });
});
