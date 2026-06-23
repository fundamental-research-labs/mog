import type {
  ObjectDigest,
  VersionObjectType,
} from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  RAW_OBJECT_PREIMAGE_CANARY,
  RAW_OBJECT_PREIMAGE_PATH,
} from './version-object-corruption-helpers-constants';

type ObjectGraphWithCorruptionHook = {
  readonly objectStore: {
    putCorruptRecordForTesting(digest: ObjectDigest, record: VersionObjectRecord<unknown>): void;
  };
};

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

export function corruptStoredRecord(
  graph: ObjectGraphWithCorruptionHook,
  record: VersionObjectRecord<unknown>,
): void {
  graph.objectStore.putCorruptRecordForTesting(record.digest, {
    ...record,
    preimage: {
      ...record.preimage,
      payload: {
        rawObjectPreimage: RAW_OBJECT_PREIMAGE_CANARY,
        path: RAW_OBJECT_PREIMAGE_PATH,
      },
    },
  });
}
