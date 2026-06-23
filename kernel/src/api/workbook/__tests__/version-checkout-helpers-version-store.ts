import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionGraphWriteResult } from '../../../document/version-store/graph-store';
import {
  createInMemoryWorkbookCommitStore,
  type CreateWorkbookCommitResult,
  type InMemoryWorkbookCommitStore,
} from '../../../document/version-store/commit-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  InMemoryVersionObjectStore,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const NAMESPACE: VersionGraphNamespace = {
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

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export type Stores = {
  readonly objectStore: InMemoryVersionObjectStore;
  readonly commitStore: InMemoryWorkbookCommitStore;
};

export function createStores(): Stores {
  const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
  return {
    objectStore,
    commitStore: createInMemoryWorkbookCommitStore(objectStore),
  };
}

function expectCreateSuccess(
  result: CreateWorkbookCommitResult,
): asserts result is Extract<CreateWorkbookCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit create success: ${result.diagnostics[0]?.code}`);
  }
}

async function objectRecord(
  stores: Stores,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(stores.objectStore.namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

export async function scopedObjectRecord(
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

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectGraphWriteSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

export async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await scopedObjectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await scopedObjectRecord(
        namespace,
        'workbook.semanticChangeSet.v1',
        {
          label,
          changes: [],
        },
      ),
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}

export async function createCommit(stores: Stores, label: string) {
  const snapshotRootRecord = await objectRecord(stores, 'workbook.snapshotRoot.v1', {
    label,
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord(stores, 'workbook.semanticChangeSet.v1', {
    label,
    changes: [],
  });
  const created = await stores.commitStore.createWorkbookCommit({
    documentId: NAMESPACE.documentId,
    parentCommitIds: [],
    snapshotRootRecord,
    semanticChangeSetRecord,
    mutationSegmentRecords: [],
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  });
  expectCreateSuccess(created);
  return created.commit;
}

export function plannedCheckoutResult(commitId: string) {
  return {
    ok: true,
    materialization: 'planned',
    plan: {
      strategy: 'fullSnapshot',
      commitId,
      parentCommitIds: [],
      resolvedTarget: { kind: 'commit', commitId },
      requiredDependencies: [{ role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' }],
    },
    diagnostics: [],
    mutationGuarantee: 'no-workbook-mutation',
  };
}
