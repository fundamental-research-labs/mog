import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
import type { WorkbookCommitCompletenessDiagnostic } from '../../../document/version-store/commit-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type {
  VersionDocumentScope,
  VersionGraphInitializeInput,
  VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}

export async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = {
    workspaceId: DOCUMENT_SCOPE.workspaceId,
    documentId: DOCUMENT_SCOPE.documentId,
    graphId,
    principalScope: DOCUMENT_SCOPE.principalScope,
  };
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
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

export function createSemanticDiffCommitCapture(
  label: string,
  changes: readonly unknown[] = defaultSemanticChanges(label),
  completenessDiagnostics: readonly WorkbookCommitCompletenessDiagnostic[] = [],
  options: {
    readonly reviewChanges?: readonly unknown[];
  } = {},
): VersionNormalCommitCapture {
  return async ({ namespace, currentMain }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentMain.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        label,
        changes,
        ...(options.reviewChanges === undefined ? {} : { reviewChanges: options.reviewChanges }),
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentMain.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics,
    },
  });
}

export function defaultSemanticChanges(label: string) {
  return [
    {
      changeId: `${label}-change-1`,
      domain: 'cell',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
      before: { kind: 'value', value: 1 },
      after: { kind: 'value', value: 2 },
      display: {
        sheetName: { kind: 'value', value: 'Sheet1' },
        address: { kind: 'value', value: 'A1' },
      },
    },
  ];
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
