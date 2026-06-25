import type { VersionDependencyRef, VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import { NAMESPACE } from './graph-store-test-utils-constants';

export async function objectRecord(
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
