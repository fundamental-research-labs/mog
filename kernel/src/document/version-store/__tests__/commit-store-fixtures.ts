import type { VersionDependencyRef } from '../object-digest';
import { createVersionObjectRecord, type VersionObjectRecord } from '../object-store';
import type { WorkbookCommitPayload } from '../commit-store';
import { AUTHOR, NAMESPACE, objectRecord } from './commit-store-test-helpers';

export interface RootCommitObjects {
  readonly snapshotRoot: VersionObjectRecord<unknown>;
  readonly semanticChangeSet: VersionObjectRecord<unknown>;
}

export async function rootCommitObjects(): Promise<RootCommitObjects> {
  const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { sheets: [] });
  const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
    changes: [],
  });

  return { snapshotRoot, semanticChangeSet };
}

export function rootCommitPayload(
  snapshotRoot: VersionObjectRecord<unknown>,
  semanticChangeSet: VersionObjectRecord<unknown>,
  overrides: Partial<WorkbookCommitPayload> = {},
): WorkbookCommitPayload {
  return {
    schemaVersion: 1,
    documentId: NAMESPACE.documentId,
    parentCommitIds: [],
    snapshotRootDigest: snapshotRoot.digest,
    semanticChangeSetDigest: semanticChangeSet.digest,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
    ...overrides,
  };
}

export function rootCommitObjectDependencies(
  snapshotRoot: VersionObjectRecord<unknown>,
  semanticChangeSet: VersionObjectRecord<unknown>,
): VersionDependencyRef[] {
  return [
    {
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: semanticChangeSet.digest,
    },
    {
      kind: 'object',
      objectType: 'workbook.snapshotRoot.v1',
      digest: snapshotRoot.digest,
    },
  ];
}

export async function rootCommitRecord(
  snapshotRoot: VersionObjectRecord<unknown>,
  semanticChangeSet: VersionObjectRecord<unknown>,
  payload: unknown = rootCommitPayload(snapshotRoot, semanticChangeSet),
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(NAMESPACE, {
    objectType: 'workbook.commit.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: rootCommitObjectDependencies(snapshotRoot, semanticChangeSet),
    payload,
  });
}
