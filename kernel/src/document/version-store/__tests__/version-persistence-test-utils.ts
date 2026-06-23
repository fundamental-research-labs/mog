import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeResult,
  type VersionStoreProvider,
} from '../provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export const CREATED_AT = '2026-06-20T00:00:00.000Z';

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function createVersionPersistenceTestProvider() {
  return createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
}

export function versionPersistenceNamespace(graphId: string): VersionGraphNamespace {
  return namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
}

export async function initializeGraphRoot(input: {
  readonly provider: VersionStoreProvider;
  readonly graphId: string;
  readonly snapshotRootRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord: VersionObjectRecord<unknown>;
}): Promise<Extract<VersionGraphInitializeResult, { status: 'success' }>> {
  const initialized = await input.provider.initializeGraph({
    expectedRegistryRevision: null,
    graphId: input.graphId,
    rootWrite: {
      snapshotRootRecord: input.snapshotRootRecord,
      semanticChangeSetRecord: input.semanticChangeSetRecord,
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
  expectInitializeSuccess(initialized);
  return initialized;
}

export async function objectRecord(
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
