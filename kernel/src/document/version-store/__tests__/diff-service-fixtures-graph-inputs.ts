import type { CommitVersionGraphInput, VersionGraphNamespace } from '../graph';
import type { VersionObjectType, WorkbookCommitId } from '../object-digest';
import { createVersionObjectRecord, type VersionObjectRecord } from '../object-store';
import { namespaceForDocumentScope, type VersionGraphInitializeInput } from '../provider';
import type { RefVersion } from '../refs/ref-store';
import {
  DIFF_SERVICE_AUTHOR,
  DIFF_SERVICE_CREATED_AT,
  DIFF_SERVICE_DOCUMENT_SCOPE,
} from './diff-service-fixtures-graph-context';

export async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DIFF_SERVICE_DOCUMENT_SCOPE, graphId);
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
      author: DIFF_SERVICE_AUTHOR,
      createdAt: DIFF_SERVICE_CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

export async function commitInput(
  namespace: VersionGraphNamespace,
  label: string,
  semanticPayload: unknown,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
  options: {
    readonly targetRef?: string;
    readonly parentCommitIds?: readonly WorkbookCommitId[];
  } = {},
): Promise<CommitVersionGraphInput> {
  return {
    ...(await graphContentInput(namespace, label, semanticPayload)),
    ...(options.targetRef
      ? { targetRef: options.targetRef, expectedTargetRefVersion: expectedMainRefVersion }
      : { expectedMainRefVersion }),
    ...(options.parentCommitIds ? { parentCommitIds: options.parentCommitIds } : {}),
    expectedHeadCommitId,
  };
}

export async function graphContentInput(
  namespace: VersionGraphNamespace,
  label: string,
  semanticPayload: unknown,
) {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(
      namespace,
      'workbook.semanticChangeSet.v1',
      semanticPayload,
    ),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${label}-segment-1`,
      }),
    ],
    author: DIFF_SERVICE_AUTHOR,
    createdAt: DIFF_SERVICE_CREATED_AT,
    completenessDiagnostics: [],
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
