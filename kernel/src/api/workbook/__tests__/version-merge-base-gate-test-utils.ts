import { expect, jest } from '@jest/globals';

import type { VersionMergeInput } from '@mog-sdk/contracts/api';
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
  type VersionGraphStore,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionStoreProvider,
} from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';

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

export function publicWorkbookVersion(provider: VersionStoreProvider, merge: unknown) {
  return new WorkbookVersionImpl({
    versioning: {
      provider,
      mergeService: { merge },
      ...versionDomainSupportManifestRuntime(),
    },
  } as any);
}

export function mergeServiceMustNotRun() {
  return jest.fn(async () => {
    throw new Error('merge service should not be invoked after merge-base resolution fails');
  });
}

export function providerWithClosureSubstitution(
  provider: VersionStoreProvider,
  requestedCommitId: WorkbookCommitId,
  returnedCommitId: WorkbookCommitId,
): VersionStoreProvider {
  const readGraphRegistry: VersionStoreProvider['readGraphRegistry'] = () =>
    provider.readGraphRegistry();
  const openGraph: VersionStoreProvider['openGraph'] = async (namespace, accessContext) =>
    graphWithClosureSubstitution(
      await provider.openGraph(namespace, accessContext),
      requestedCommitId,
      returnedCommitId,
    );

  return {
    readGraphRegistry,
    openGraph,
  } as VersionStoreProvider;
}

function graphWithClosureSubstitution(
  graph: VersionGraphStore,
  requestedCommitId: WorkbookCommitId,
  returnedCommitId: WorkbookCommitId,
): VersionGraphStore {
  return new Proxy(graph, {
    get(target, property, receiver) {
      if (property !== 'readCommitClosure') return Reflect.get(target, property, receiver);
      return (commitId: WorkbookCommitId | string) =>
        target.readCommitClosure(commitId === requestedCommitId ? returnedCommitId : commitId);
    },
  });
}

export function expectPublicSafeMergeFailure(
  result: Awaited<ReturnType<WorkbookVersionImpl['merge']>>,
  code: string,
  payload: Readonly<Record<string, string | number | boolean | null>> = {},
) {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.merge',
      diagnostics: [
        expect.objectContaining({
          code,
          owner: 'version-store',
          data: expect.objectContaining({
            operation: 'merge',
            redacted: true,
            payload: expect.objectContaining({
              operation: 'merge',
              ...payload,
            }),
          }),
        }),
      ],
    },
  });
  if (result.ok) {
    throw new Error('expected public merge failure');
  }

  const diagnostic = result.error.diagnostics.find((item) => item.code === code);
  expect(diagnostic).toBeDefined();
  expect(JSON.stringify(diagnostic)).not.toContain('commit:sha256:');
  return diagnostic!;
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

export function commitId(hexDigit: string): VersionMergeInput['base'] {
  return `commit:sha256:${hexDigit.repeat(64)}` as VersionMergeInput['base'];
}
