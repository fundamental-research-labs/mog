import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import { jest } from '@jest/globals';

import {
  createCheckoutMaterializationService,
  type CheckoutMaterializationRequest,
  type CheckoutMaterializationResult,
} from '../checkout-service';
import {
  parseWorkbookCommitId,
  type VersionDependencyRef,
  type VersionObjectType,
  type WorkbookCommitId,
} from '../object-digest';
import {
  InMemoryVersionObjectStore,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  createInMemoryWorkbookCommitStore,
  type CreateWorkbookCommitResult,
  type InMemoryWorkbookCommitStore,
  type WorkbookCommitCompletenessDiagnostic,
} from '../commit-store';
import { createInMemoryRefStore, type RefMutationResult, type RefVersion } from '../ref-store';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

type Stores = {
  readonly objectStore: InMemoryVersionObjectStore;
  readonly commitStore: InMemoryWorkbookCommitStore;
};

type CommitFixture = {
  readonly commit: Extract<CreateWorkbookCommitResult, { status: 'success' }>['commit'];
  readonly snapshotRootRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord: VersionObjectRecord<unknown>;
  readonly mutationSegmentRecords: readonly VersionObjectRecord<unknown>[];
};

function createStores(): Stores {
  const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
  return {
    objectStore,
    commitStore: createInMemoryWorkbookCommitStore(objectStore),
  };
}

function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

function refVersion(value: string): RefVersion {
  return { kind: 'counter', value };
}

function expectPlanOk(
  result: CheckoutMaterializationResult,
): asserts result is Extract<CheckoutMaterializationResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected checkout plan success: ${result.error.code}`);
  }
}

function expectPlanFailed(
  result: CheckoutMaterializationResult,
): asserts result is Extract<CheckoutMaterializationResult, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('expected checkout plan failure');
  }
}

function expectCreateSuccess(
  result: CreateWorkbookCommitResult,
): asserts result is Extract<CreateWorkbookCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit create success: ${result.diagnostics[0]?.code}`);
  }
}

function expectMutationOk(
  result: RefMutationResult,
): asserts result is Extract<RefMutationResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected ref mutation success: ${result.error.code}`);
  }
}

async function objectRecord(
  stores: Stores,
  objectType: VersionObjectType,
  payload: unknown,
  dependencies: readonly VersionDependencyRef[] = [],
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(stores.objectStore.namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}

async function createCommitFixture(
  stores: Stores,
  label: string,
  options: {
    readonly parentCommitIds?: readonly WorkbookCommitId[];
    readonly mutationSegmentPayloads?: readonly unknown[];
    readonly completenessDiagnostics?: readonly WorkbookCommitCompletenessDiagnostic[];
  } = {},
): Promise<CommitFixture> {
  const snapshotRootRecord = await objectRecord(stores, 'workbook.snapshotRoot.v1', {
    label,
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord(stores, 'workbook.semanticChangeSet.v1', {
    label,
    changes: [],
  });
  const mutationSegmentRecords = await Promise.all(
    (options.mutationSegmentPayloads ?? []).map((payload) =>
      objectRecord(stores, 'workbook.mutationSegment.v1', payload),
    ),
  );

  const created = await stores.commitStore.createWorkbookCommit({
    documentId: NAMESPACE.documentId,
    parentCommitIds: options.parentCommitIds ?? [],
    snapshotRootRecord,
    semanticChangeSetRecord,
    mutationSegmentRecords,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: options.completenessDiagnostics ?? [],
  });
  expectCreateSuccess(created);

  return {
    commit: created.commit,
    snapshotRootRecord,
    semanticChangeSetRecord,
    mutationSegmentRecords,
  };
}

function createService(stores: Stores) {
  return createCheckoutMaterializationService({
    commitReader: stores.commitStore,
    dependencyReader: {
      hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
    },
  });
}

describe('CheckoutMaterializationService planning', () => {
  it('creates a stable full-snapshot materialization plan for an explicit commit', async () => {
    const stores = createStores();
    const root = await createCommitFixture(stores, 'root');
    const child = await createCommitFixture(stores, 'child', {
      parentCommitIds: [root.commit.id],
      mutationSegmentPayloads: [{ segmentId: 'segment-1' }],
    });
    const service = createService(stores);

    const result = await service.planCheckout({
      target: 'commit',
      commitId: child.commit.id,
    });

    expectPlanOk(result);
    expect(result.mutationGuarantee).toBe('no-workbook-mutation');
    expect(Object.isFrozen(result.plan)).toBe(true);
    expect(result.plan).toMatchObject({
      strategy: 'fullSnapshot',
      resolvedTarget: { kind: 'commit', commitId: child.commit.id },
      commitId: child.commit.id,
      parentCommitIds: [root.commit.id],
      snapshotRootDigest: child.snapshotRootRecord.digest,
      semanticChangeSetDigest: child.semanticChangeSetRecord.digest,
      mutationSegmentDigests: [child.mutationSegmentRecords[0].digest],
    });
    expect(result.plan.requiredDependencies.map((dependency) => dependency.role)).toEqual([
      'snapshotRoot',
      'semanticChangeSet',
      'mutationSegment',
    ]);
    expect(result.plan.requiredDependencyDigests).toEqual([
      child.snapshotRootRecord.digest,
      child.semanticChangeSetRecord.digest,
      child.mutationSegmentRecords[0].digest,
    ]);
  });

  it('applies a full-snapshot checkout only through an attached snapshot materializer', async () => {
    const stores = createStores();
    const fixture = await createCommitFixture(stores, 'apply-root');
    const applySnapshot = jest.fn(async () => ({
      status: 'applied' as const,
      diagnostics: [
        {
          code: 'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC' as const,
          severity: 'info' as const,
          message: 'Applied fixture snapshot.',
          commitId: fixture.commit.id,
        },
      ],
    }));
    const service = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
      snapshotReader: {
        readSnapshotRoot: (dependency) => stores.objectStore.getObjectRecord(dependency),
      },
      snapshotMaterializer: {
        applySnapshot,
      },
    });

    const result = await service.checkout({
      target: 'commit',
      commitId: fixture.commit.id,
    });

    expectPlanOk(result);
    expect(result.materialization).toBe('applied');
    expect(result.mutationGuarantee).toBe('workbook-state-materialized');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC',
        commitId: fixture.commit.id,
      }),
    ]);
    expect(applySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'fullSnapshot',
        commitId: fixture.commit.id,
        snapshotRoot: {
          label: 'apply-root',
          sheets: [],
        },
        plan: expect.objectContaining({
          commitId: fixture.commit.id,
          snapshotRootDigest: fixture.snapshotRootRecord.digest,
        }),
      }),
    );
  });

  it('reports partial-mutation uncertainty when the snapshot materializer throws', async () => {
    const stores = createStores();
    const fixture = await createCommitFixture(stores, 'apply-failure');
    const service = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
      snapshotReader: {
        readSnapshotRoot: (dependency) => stores.objectStore.getObjectRecord(dependency),
      },
      snapshotMaterializer: {
        applySnapshot: async () => {
          throw new Error('materializer failed');
        },
      },
    });

    const result = await service.checkout({
      target: 'commit',
      commitId: fixture.commit.id,
    });

    expectPlanFailed(result);
    expect(result.error.code).toBe('checkoutSnapshotApplyFailed');
    expect(result.mutationGuarantee).toBe('unknown-after-partial-mutation');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
        commitId: fixture.commit.id,
      }),
    ]);
  });

  it('resolves HEAD and main through supplied readers before reading commits', async () => {
    const stores = createStores();
    const root = await createCommitFixture(stores, 'root');
    const child = await createCommitFixture(stores, 'child', {
      parentCommitIds: [root.commit.id],
    });
    const refStore = createInMemoryRefStore({
      versionDocumentId: NAMESPACE.documentId,
      now: () => '2026-06-20T00:00:00.000Z',
    });
    const main = refStore.initializeMain({ targetCommitId: root.commit.id, createdBy: AUTHOR });
    expectMutationOk(main);

    const calls: string[] = [];
    const service = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
      headReader: {
        readHead: () => {
          calls.push('head');
          return {
            ok: true,
            head: {
              mode: 'attached',
              refName: 'scenario/work',
              commitId: child.commit.id,
              refVersion: refVersion('7'),
              refIncarnationId: 'ref-incarnation:scenario-work',
            },
            diagnostics: [],
          };
        },
      },
      refReader: {
        readRef: (refName) => {
          calls.push(`ref:${refName}`);
          return refStore.getRef(refName);
        },
      },
    });

    const head = await service.planCheckout({ target: 'ref', refName: 'HEAD' });
    const mainResult = await service.planCheckout({ target: 'ref', refName: 'main' });

    expectPlanOk(head);
    expectPlanOk(mainResult);
    expect(head.plan.resolvedTarget).toEqual({
      kind: 'head',
      refName: 'scenario/work',
      commitId: child.commit.id,
      refVersion: refVersion('7'),
      refIncarnationId: 'ref-incarnation:scenario-work',
    });
    expect(mainResult.plan.resolvedTarget).toMatchObject({
      kind: 'ref',
      refName: 'main',
      commitId: root.commit.id,
      refVersion: main.ref.refVersion,
      refIncarnationId: main.ref.refIncarnationId,
    });
    expect(calls).toEqual(['head', 'ref:main']);
  });

  it('rejects invalid and detached target grammar without reading commits', async () => {
    const stores = createStores();
    const readCommit = jest.fn(stores.commitStore.readCommit.bind(stores.commitStore));
    const service = createCheckoutMaterializationService({
      commitReader: { readCommit },
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
    });

    const invalidCommit = await service.planCheckout({
      target: 'commit',
      commitId: 'not-a-commit',
    });
    const detached = await service.planCheckout({
      target: 'detached',
      commitId: commit('aa'),
    } as unknown as CheckoutMaterializationRequest);

    expectPlanFailed(invalidCommit);
    expect(invalidCommit.error.code).toBe('invalidCheckoutTarget');
    expect(invalidCommit.diagnostics[0]).toMatchObject({
      code: 'VERSION_CHECKOUT_INVALID_TARGET',
    });
    expectPlanFailed(detached);
    expect(detached.error.code).toBe('unsupportedCheckoutTarget');
    expect(detached.diagnostics[0]).toMatchObject({
      code: 'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED',
    });
    expect(readCommit).not.toHaveBeenCalled();
  });

  it('returns missing-ref diagnostics before commit reads', async () => {
    const stores = createStores();
    const readCommit = jest.fn(stores.commitStore.readCommit.bind(stores.commitStore));
    const service = createCheckoutMaterializationService({
      commitReader: { readCommit },
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
      refReader: {
        readRef: () => ({ ok: true, ref: null, diagnostics: [] }),
      },
    });

    const result = await service.planCheckout({
      target: 'ref',
      refName: 'scenario/missing',
    });

    expectPlanFailed(result);
    expect(result.error.code).toBe('checkoutRefNotFound');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_CHECKOUT_MISSING_REF',
      refName: 'scenario/missing',
    });
    expect(readCommit).not.toHaveBeenCalled();
  });

  it('preserves missing-commit diagnostics from the supplied commit reader', async () => {
    const stores = createStores();
    const service = createService(stores);

    const result = await service.planCheckout({
      target: 'commit',
      commitId: commit('ee'),
    });

    expectPlanFailed(result);
    expect(result.error.code).toBe('checkoutCommitNotFound');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_CHECKOUT_MISSING_COMMIT',
      commitId: commit('ee'),
      sourceDiagnostics: [
        expect.objectContaining({
          code: 'VERSION_OBJECT_STORE_FAILURE',
        }),
      ],
    });
  });

  it('rejects commits with blocking materialization completeness diagnostics', async () => {
    const stores = createStores();
    const fixture = await createCommitFixture(stores, 'unsupported-domain', {
      completenessDiagnostics: [
        {
          code: 'opaqueDomainUnsupported',
          severity: 'error',
          message: 'Opaque domain cannot be materialized.',
          path: 'opaqueDomains[0]',
        },
      ],
    });
    const service = createService(stores);

    const result = await service.planCheckout({
      target: 'commit',
      commitId: fixture.commit.id,
    });

    expectPlanFailed(result);
    expect(result.error.code).toBe('checkoutCommitUnmaterializable');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT',
      commitId: fixture.commit.id,
      sourceDiagnostics: [
        expect.objectContaining({
          code: 'opaqueDomainUnsupported',
          severity: 'error',
        }),
      ],
    });
  });

  it('returns missing dependency diagnostics when materialization objects are absent', async () => {
    const stores = createStores();
    const fixture = await createCommitFixture(stores, 'missing-dependency');
    const service = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) =>
          dependency.kind === 'object' && dependency.objectType === 'workbook.semanticChangeSet.v1'
            ? false
            : stores.objectStore.hasObject(dependency),
      },
    });

    const result = await service.planCheckout({
      target: 'commit',
      commitId: fixture.commit.id,
    });

    expectPlanFailed(result);
    expect(result.error.code).toBe('checkoutDependencyMissing');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_CHECKOUT_MISSING_DEPENDENCY',
        commitId: fixture.commit.id,
        objectDigest: fixture.semanticChangeSetRecord.digest,
        dependency: {
          kind: 'object',
          objectType: 'workbook.semanticChangeSet.v1',
          digest: fixture.semanticChangeSetRecord.digest,
        },
      }),
    ]);
  });

  it('does not mutate ref state while resolving a checkout plan', async () => {
    const stores = createStores();
    const fixture = await createCommitFixture(stores, 'main');
    const refStore = createInMemoryRefStore({
      versionDocumentId: NAMESPACE.documentId,
      now: () => '2026-06-20T00:00:00.000Z',
    });
    const main = refStore.initializeMain({ targetCommitId: fixture.commit.id, createdBy: AUTHOR });
    expectMutationOk(main);
    const before = refStore.getRef('main');
    const attemptedWrites: string[] = [];
    const service = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
      refReader: {
        readRef: (refName) => refStore.getRef(refName),
      },
    });

    const result = await service.planCheckout({ target: 'ref', refName: 'main' });

    expectPlanOk(result);
    expect(refStore.getRef('main')).toEqual(before);
    expect(attemptedWrites).toEqual([]);
  });
});
