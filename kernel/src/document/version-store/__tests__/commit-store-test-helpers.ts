import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionDependencyRef, VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type {
  CreateWorkbookCommitInput,
  CreateWorkbookCommitResult,
  ReadWorkbookCommitResult,
} from '../commit-store';

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

export const OTHER_AUTHOR: VersionAuthor = {
  authorId: 'user-2',
  actorKind: 'user',
  displayName: 'User Two',
};

export function expectCreateSuccess(
  result: CreateWorkbookCommitResult,
): asserts result is Extract<CreateWorkbookCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit create success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectCreateFailed(
  result: CreateWorkbookCommitResult,
): asserts result is Extract<CreateWorkbookCommitResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected commit create failure');
  }
}

export function expectReadSuccess(
  result: ReadWorkbookCommitResult,
): asserts result is Extract<ReadWorkbookCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit read success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectReadFailed(
  result: ReadWorkbookCommitResult,
): asserts result is Extract<ReadWorkbookCommitResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected commit read failure');
  }
}

export async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  dependencies: readonly VersionDependencyRef[] = [],
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(NAMESPACE, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}

export function baseInput(
  snapshotRootRecord: VersionObjectRecord<unknown>,
  semanticChangeSetRecord: VersionObjectRecord<unknown>,
): CreateWorkbookCommitInput {
  return {
    documentId: NAMESPACE.documentId,
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

export function assertCreateInputRejectsMessage(
  snapshotRootRecord: VersionObjectRecord<unknown>,
  semanticChangeSetRecord: VersionObjectRecord<unknown>,
): CreateWorkbookCommitInput {
  return {
    documentId: NAMESPACE.documentId,
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
    // @ts-expect-error messages live in mutable commit annotations, not immutable payloads.
    message: 'annotation text',
  };
}
