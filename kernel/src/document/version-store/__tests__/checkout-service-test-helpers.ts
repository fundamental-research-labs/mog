import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  createCheckoutMaterializationService,
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
import type { RefMutationResult, RefVersion } from '../refs/ref-store';

export const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export type Stores = {
  readonly objectStore: InMemoryVersionObjectStore;
  readonly commitStore: InMemoryWorkbookCommitStore;
};

export type CommitFixture = {
  readonly commit: Extract<CreateWorkbookCommitResult, { status: 'success' }>['commit'];
  readonly snapshotRootRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord: VersionObjectRecord<unknown>;
  readonly mutationSegmentRecords: readonly VersionObjectRecord<unknown>[];
};

export function createStores(): Stores {
  const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
  return {
    objectStore,
    commitStore: createInMemoryWorkbookCommitStore(objectStore),
  };
}

export function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

export function refVersion(value: string): RefVersion {
  return { kind: 'counter', value };
}

export function expectPlanOk(
  result: CheckoutMaterializationResult,
): asserts result is Extract<CheckoutMaterializationResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected checkout plan success: ${result.error.code}`);
  }
}

export function expectPlanFailed(
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

export function expectMutationOk(
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

export async function createCommitFixture(
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

export function createService(stores: Stores) {
  return createCheckoutMaterializationService({
    commitReader: stores.commitStore,
    dependencyReader: {
      hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
    },
  });
}
