import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionGraphInitializeInput, VersionGraphInitializeResult } from '../provider';

import { expectInitializeSuccess } from './snapshot-root-materialization-service-assertions.test-helpers';
import { AUTHOR, CREATED_AT } from './snapshot-root-materialization-service-constants.test-helpers';

export async function objectRecord(
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

export async function initializeGraphWithSnapshotRoot(
  provider: {
    initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
  },
  namespace: VersionGraphNamespace,
  snapshotRootRecord: VersionObjectRecord<unknown>,
): Promise<Extract<VersionGraphInitializeResult, { status: 'success' }>> {
  const initialized = await provider.initializeGraph({
    expectedRegistryRevision: null,
    graphId: namespace.graphId,
    rootWrite: {
      snapshotRootRecord,
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
  expectInitializeSuccess(initialized);
  return initialized;
}
