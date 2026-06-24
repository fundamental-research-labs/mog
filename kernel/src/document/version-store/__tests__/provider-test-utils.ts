import type { WorkbookCommitId as PublicWorkbookCommitId } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionGraphReadHeadResult } from '../graph';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType } from '../object-digest';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphRegistryReadResult,
} from '../provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export const OTHER_DOCUMENT_SCOPE: VersionDocumentScope = {
  ...DOCUMENT_SCOPE,
  documentId: 'document-2',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const MISSING_COMMIT_ID =
  'commit:sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as PublicWorkbookCommitId;

export function expectRegistryOk(
  result: VersionGraphRegistryReadResult,
): asserts result is Extract<VersionGraphRegistryReadResult, { status: 'ok' }> {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') {
    throw new Error(`expected registry ok: ${result.diagnostics[0]?.code}`);
  }
}

export function expectRegistryAbsent(
  result: VersionGraphRegistryReadResult,
): asserts result is Extract<VersionGraphRegistryReadResult, { status: 'absent' }> {
  expect(result.status).toBe('absent');
  if (result.status !== 'absent') {
    throw new Error('expected registry absent');
  }
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectInitializeFailed(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected initialize failure');
  }
}

export function expectReadHeadSuccess(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readHead success: ${result.diagnostics[0]?.code}`);
  }
}

export async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

export async function rootWrite(
  label: string,
  namespace: VersionGraphNamespace,
): Promise<VersionGraphInitializeInput['rootWrite']> {
  return {
    snapshotRootRecord: await objectRecord(
      'workbook.snapshotRoot.v1',
      { label, sheets: [] },
      namespace,
    ),
    semanticChangeSetRecord: await objectRecord(
      'workbook.semanticChangeSet.v1',
      { label, changes: [] },
      namespace,
    ),
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

export async function initializeInput(
  graphId: string,
  documentScope: VersionDocumentScope = DOCUMENT_SCOPE,
  label = 'root',
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite(label, namespace),
  };
}
