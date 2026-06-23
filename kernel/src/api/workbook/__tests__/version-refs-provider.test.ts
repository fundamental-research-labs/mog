import { jest } from '@jest/globals';

import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import { installVersionDomainDetectorNoopsOnBridgeMock } from './version-domain-support-test-utils';
import {
  CREATED_AT,
  DOCUMENT_SCOPE,
  commitGraphChild,
  createNormalCommitCapture,
  createWorkbook,
  expectInitializeSuccess,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
  initializeInput,
  resetWorkbookProviderTestMocks,
} from './version-refs-provider-test-utils';

describe('WorkbookVersion provider-backed ref lifecycle facade', () => {
  beforeEach(() => {
    resetWorkbookProviderTestMocks();
  });

  it('routes public branch refs through the provider-attached lifecycle service', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const child = await commitGraphChild(
      graph,
      'graph-1',
      initialized.rootCommit.id,
      initialized.initialHead.revision,
      'branch-target',
    );

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

  it('rejects symbolic HEAD, immutable main, and tag-shaped refs before provider write attempts', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const child = await commitGraphChild(
      graph,
      'graph-1',
      initialized.rootCommit.id,
      initialized.initialHead.revision,
      'immutable-target',
    );
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });
    const readGraphRegistry = jest.spyOn(provider, 'readGraphRegistry');
    const openGraph = jest.spyOn(provider, 'openGraph');
    const tagRef = 'refs/tags/release-secret' as any;

    const protectedHeadCreate = await wb.version.createBranch({
      name: 'HEAD' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(protectedHeadCreate, 'VERSION_PERMISSION_DENIED');

    const protectedHeadAdvance = await wb.version.fastForwardBranch({
      name: 'HEAD' as any,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedHeadAdvance, 'VERSION_PERMISSION_DENIED');

    const protectedHeadDelete = await wb.version.deleteBranch({
      name: 'HEAD' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedHeadDelete, 'VERSION_PERMISSION_DENIED');

    const protectedCreate = await wb.version.createBranch({
      name: 'refs/heads/main' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(protectedCreate, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const protectedAdvance = await wb.version.fastForwardBranch({
      name: 'main' as any,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedAdvance, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const protectedDelete = await wb.version.deleteRef({
      name: 'refs/heads/main' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedDelete, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const protectedDeleteBranch = await wb.version.deleteBranch({
      name: 'main' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedDeleteBranch, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const tagCreate = await wb.version.createBranch({
      name: tagRef,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(tagCreate, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });
    expectNoDiagnosticLeak(tagCreate, 'refs/tags/release-secret', 'release-secret');

    const tagAdvance = await wb.version.fastForwardBranch({
      name: tagRef,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(tagAdvance, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });
    expectNoDiagnosticLeak(tagAdvance, 'refs/tags/release-secret', 'release-secret');

    const tagDelete = await wb.version.deleteRef({
      name: tagRef,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(tagDelete, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });
    expectNoDiagnosticLeak(tagDelete, 'refs/tags/release-secret', 'release-secret');

    expect(readGraphRegistry).not.toHaveBeenCalled();
    expect(openGraph).not.toHaveBeenCalled();
  });

  it('surfaces duplicate provider branch names as redacted no-write conflicts', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/duplicate' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/duplicate',
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
    });

    const duplicate = await wb.version.createBranch({
      name: 'refs/heads/scenario/duplicate' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(duplicate, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(duplicate, 'scenario/duplicate');

    await expect(wb.version.readRef('refs/heads/scenario/duplicate' as any)).resolves.toMatchObject(
      {
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/scenario/duplicate',
            commitId: initialized.rootCommit.id,
            revision: { kind: 'counter', value: '0' },
          },
        },
      },
    );
    await expect(wb.version.listRefs({ prefix: 'scenario' as any })).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            name: 'refs/heads/scenario/duplicate',
            commitId: initialized.rootCommit.id,
          }),
        ],
        limit: 50,
      },
    });
  });

  it('keeps provider branches unchanged on stale fast-forward CAS failures', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const child = await commitGraphChild(
      graph,
      'graph-1',
      initialized.rootCommit.id,
      initialized.initialHead.revision,
      'stale-cas-child',
    );
    const next = await commitGraphChild(
      graph,
      'graph-1',
      child.commit.id,
      child.ref.revision,
      'stale-cas-next',
    );
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/stale-cas' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/stale-cas',
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
    });

    await expect(
      wb.version.fastForwardBranch({
        name: 'scenario/stale-cas' as any,
        nextCommitId: child.commit.id,
        expectedHead: initialized.rootCommit.id,
        expectedRefRevision: { kind: 'counter', value: '0' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/stale-cas',
        commitId: child.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });

    const stale = await wb.version.fastForwardBranch({
      name: 'refs/heads/scenario/stale-cas' as any,
      nextCommitId: next.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(stale, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
        conflict: 'expectedHeadMismatch',
      }),
    });
    expectNoDiagnosticLeak(stale, 'scenario/stale-cas');

    await expect(wb.version.readRef('refs/heads/scenario/stale-cas' as any)).resolves.toMatchObject(
      {
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/scenario/stale-cas',
            commitId: child.commit.id,
            revision: { kind: 'counter', value: '1' },
          },
        },
      },
    );
  });

  it('keeps tombstoned provider branches deleted on stale fast-forward and delete attempts', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const child = await commitGraphChild(
      graph,
      'graph-1',
      initialized.rootCommit.id,
      initialized.initialHead.revision,
      'deleted-stale-child',
    );
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/deleted-stale' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/deleted-stale',
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
    });

    await expect(
      wb.version.deleteRef({
        name: 'scenario/deleted-stale' as any,
        expectedHead: initialized.rootCommit.id,
        expectedRefRevision: { kind: 'counter', value: '0' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/deleted-stale',
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });

    const staleAdvance = await wb.version.fastForwardBranch({
      name: 'refs/heads/scenario/deleted-stale' as any,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(staleAdvance, 'VERSION_DANGLING_REF', {
      recoverability: 'unsupported',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(staleAdvance, 'scenario/deleted-stale');

    const staleDelete = await wb.version.deleteRef({
      name: 'scenario/deleted-stale' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(staleDelete, 'VERSION_DANGLING_REF', {
      recoverability: 'unsupported',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(staleDelete, 'scenario/deleted-stale');

    await expect(
      wb.version.readRef('refs/heads/scenario/deleted-stale' as any),
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
    const listed = await wb.version.listRefs({ prefix: 'scenario' as any });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(`expected listRefs success: ${listed.error.code}`);
    expect(listed.value.items.map((ref) => ref.name)).not.toContain(
      'refs/heads/scenario/deleted-stale',
    );
  });

  it('preflights provider delete current and stale revisions before tombstone writes', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const child = await commitGraphChild(
      graph,
      'graph-1',
      initialized.rootCommit.id,
      initialized.initialHead.revision,
      'delete-preflight-child',
    );
    const deleteBranch = jest.spyOn(graph, 'deleteBranch');
    const wb = createWorkbook({ versioning: { provider } });

    await wb.version.createBranch({
      name: 'scenario/delete-preflight' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    await wb.version.fastForwardBranch({
      name: 'scenario/delete-preflight' as any,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });

    const stale = await wb.version.deleteRef({
      name: 'scenario/delete-preflight' as any,
      expectedHead: child.commit.id,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(stale, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
        conflict: 'expectedRefVersionMismatch',
      }),
    });
    expectNoDiagnosticLeak(stale, 'scenario/delete-preflight');

    const readActiveCheckoutSession = jest.fn(() => ({
      checkedOutCommitId: child.commit.id,
      branchName: 'refs/heads/scenario/delete-preflight',
      refHeadAtMaterialization: child.commit.id,
      detached: false,
    }));
    const versioning = (wb.version as any).ctx.versioning as Record<string, unknown>;
    const surfaceStatusService = { readActiveCheckoutSession };
    versioning.surfaceStatusService = surfaceStatusService;
    versioning.versionSurfaceStatusService = surfaceStatusService;

    const active = await wb.version.deleteRef({
      name: 'scenario/delete-preflight' as any,
      expectedHead: child.commit.id,
      expectedRefRevision: { kind: 'counter', value: '1' },
    });
    expectNoWriteFailure(active, 'VERSION_REF_WRITE_UNAVAILABLE', {
      payload: expect.objectContaining({ issue: 'activeBranchDelete' }),
    });
    expectNoDiagnosticLeak(active, 'scenario/delete-preflight');
    expect(readActiveCheckoutSession).toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
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
      installVersionDomainDetectorNoopsOnBridgeMock((wb.version as any).ctx?.computeBridge);

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
