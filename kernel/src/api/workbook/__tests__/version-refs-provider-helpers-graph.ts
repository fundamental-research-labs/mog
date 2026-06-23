import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
} from '../../../document/version-store/provider';
import {
  CREATED_AT,
  DOCUMENT_SCOPE,
  VERSION_AUTHOR,
} from './version-refs-provider-helpers-constants';

export type VersionGraphCommitSuccess = Extract<
  Awaited<ReturnType<VersionGraphStore['commit']>>,
  { readonly status: 'success' }
>;

export type VersionGraphRefRevision = Extract<
  VersionGraphInitializeResult,
  { readonly status: 'success' }
>['initialHead']['revision'];

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

export async function commitGraphChild(
  graph: VersionGraphStore,
  graphId: string,
  parentCommitId: string,
  expectedMainRefVersion: VersionGraphRefRevision,
  label: string,
): Promise<VersionGraphCommitSuccess> {
  const childInput = await initializeInput(graphId, label);
  const child = await graph.commit({
    ...childInput.rootWrite,
    expectedHeadCommitId: parentCommitId,
    expectedMainRefVersion,
  });
  expect(child.status).toBe('success');
  if (child.status !== 'success') {
    throw new Error(`expected child graph commit: ${child.diagnostics[0]?.code}`);
  }
  return child;
}

export function createNormalCommitCapture(label: string): VersionNormalCommitCapture {
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
