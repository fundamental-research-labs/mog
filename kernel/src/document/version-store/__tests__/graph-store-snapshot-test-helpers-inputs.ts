import type { CommitVersionGraphInput, InitializeVersionGraphInput } from '../graph';
import type { VersionDependencyRef, VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { RefVersion } from '../refs/ref-store';
import { AUTHOR, NAMESPACE } from './graph-store-snapshot-test-helpers-constants';

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace = NAMESPACE,
  dependencies: readonly VersionDependencyRef[] = [],
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}

export async function graphInput(label: string): Promise<InitializeVersionGraphInput> {
  return {
    snapshotRootRecord: await objectRecord('workbook.snapshotRoot.v1', { label, sheets: [] }),
    semanticChangeSetRecord: await objectRecord('workbook.semanticChangeSet.v1', {
      label,
      changes: [],
    }),
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

export function commitInput(
  input: InitializeVersionGraphInput,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
): CommitVersionGraphInput {
  return {
    ...input,
    expectedHeadCommitId,
    expectedMainRefVersion,
    parentCommitIds: [expectedHeadCommitId],
  };
}
