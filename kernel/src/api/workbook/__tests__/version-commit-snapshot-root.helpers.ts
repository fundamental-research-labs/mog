import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';
import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
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
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import { versioningWithDomainSupportManifest } from './version-domain-support-test-utils';

export const CREATED_AT = '2026-06-20T00:00:00.000Z';
export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
export const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export type InMemoryVersionStoreProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;
export type InitializedVersionGraph = Extract<VersionGraphInitializeResult, { status: 'success' }>;

export function createWorkbookVersion(
  versioning: Parameters<typeof attachWorkbookVersioning>[1],
): WorkbookVersionImpl {
  const ctx = {} as any;
  attachWorkbookVersioning(ctx, versioningWithDomainSupportManifest(versioning as any));
  return new WorkbookVersionImpl(ctx);
}

export function createProviderBackedVersion(
  provider: InMemoryVersionStoreProvider,
  encodeDiff: (stateVector: Uint8Array) => Promise<Uint8Array>,
): WorkbookVersionImpl {
  const ctx = {} as any;
  attachWorkbookVersioning(
    ctx,
    versioningWithDomainSupportManifest({
      provider,
      snapshotRootByteSyncPort: { encodeDiff },
    }),
  );
  return new WorkbookVersionImpl(ctx);
}

export function versionContext(version: WorkbookVersionImpl): any {
  return (version as any).ctx;
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is InitializedVersionGraph {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
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

export async function initializeInput(
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

export async function expectOnlyRootCommit(
  provider: InMemoryVersionStoreProvider,
  graphId: string,
  initialized: InitializedVersionGraph,
): Promise<void> {
  const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, graphId));
  await expect(graph.readHead()).resolves.toMatchObject({
    status: 'success',
    head: {
      id: initialized.rootCommit.id,
      refRevision: initialized.initialHead.revision,
    },
  });
  const listed = await graph.listCommits();
  expect(listed).toMatchObject({
    status: 'success',
    commits: [{ id: initialized.rootCommit.id }],
  });
  if (listed.status !== 'success') {
    throw new Error(`expected commit list success: ${listed.diagnostics[0]?.code}`);
  }
  expect(listed.commits).toHaveLength(1);
}

export function operationContext(
  overrides: Partial<VersionOperationContext> = {},
): VersionOperationContext {
  return {
    operationId: 'operation-1',
    kind: 'mutation',
    author: VERSION_AUTHOR,
    createdAt: CREATED_AT,
    domainIds: ['test'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    ...overrides,
  };
}

export function emptyMutationResult() {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
  };
}

export function cellValueMutationResult(value: unknown) {
  return {
    recalc: {
      changedCells: [
        {
          cellId: 'cell-a1',
          sheetId: 'sheet-1',
          position: { row: 0, col: 0 },
          oldValue: null,
          value,
          extraFlags: 0,
        },
      ],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
  };
}

export function createNormalCommitCapture(label: string): VersionNormalCommitCapture {
  return async ({ namespace, currentMain }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentMain.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [{ id: `${label}-change-1`, domain: 'test' }],
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentMain.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
}
