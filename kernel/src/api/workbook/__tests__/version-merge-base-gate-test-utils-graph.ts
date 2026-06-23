import { expect } from '@jest/globals';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createInMemoryWorkbookCommitStore } from '../../../document/version-store/commit-store';
import type {
  VersionObjectType,
  WorkbookCommitId,
} from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-vc07',
  documentId: 'document-vc07-merge-base',
  principalScope: 'principal-vc07',
};
const CREATED_AT = '2026-06-22T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-vc07',
  actorKind: 'user',
  displayName: 'VC07 User',
};

export async function graphWithRoot(graphId: string) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    provider,
    namespace,
    rootCommitId: initialized.rootCommit.id,
  };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export async function createCommit(
  graph: {
    readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
    readonly namespace: VersionGraphNamespace;
  },
  options: {
    readonly label: string;
    readonly parentCommitIds: readonly WorkbookCommitId[];
  },
): Promise<WorkbookCommitId> {
  const opened = await graph.provider.openGraph(graph.namespace);
  const commitStore = createInMemoryWorkbookCommitStore(opened.objectStore);
  const created = await commitStore.createWorkbookCommit({
    documentId: graph.namespace.documentId,
    parentCommitIds: options.parentCommitIds,
    snapshotRootRecord: await objectRecord(graph.namespace, 'workbook.snapshotRoot.v1', {
      label: options.label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(graph.namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [],
    }),
    mutationSegmentRecords: [
      await objectRecord(graph.namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${options.label}-segment-1`,
      }),
    ],
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
  });
  if (created.status !== 'success') {
    throw new Error(`expected commit create success: ${created.diagnostics[0]?.code}`);
  }
  return created.commit.id;
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
        schemaVersion: 1,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

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
