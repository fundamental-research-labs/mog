import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectPutBatchResult,
  type VersionObjectRecord,
} from '../object-store';
import type { ObjectDigest, VersionDependencyRef, VersionObjectType } from '../object-digest';

export const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

export const OTHER_NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-2',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

export const HEX_A = 'aa'.repeat(32);
export const HEX_B = 'bb'.repeat(32);
export const HEX_C = 'cc'.repeat(32);
export const HEX_D = 'dd'.repeat(32);

export function digest(hex: string): ObjectDigest {
  return { algorithm: 'sha256', digest: hex };
}

export async function record(
  payload: unknown,
  dependencies: readonly VersionDependencyRef[] = [],
  objectType: VersionObjectType = 'workbook.semanticChangeSet.v1',
  namespace = NAMESPACE,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}

export function objectRef(record: VersionObjectRecord<unknown>): VersionDependencyRef {
  return {
    kind: 'object',
    objectType: record.preimage.objectType,
    digest: record.digest,
  };
}

export function expectFailedCode(result: VersionObjectPutBatchResult, code: string): void {
  if (result.status !== 'failed') {
    throw new Error(`expected failed result, received ${result.status}`);
  }
  expect(result.mutationGuarantee).toBe('no-objects-written');
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
}

export function expectSuccess(result: VersionObjectPutBatchResult): void {
  if (result.status !== 'success') {
    throw new Error(`expected success result, received ${result.status}`);
  }
  expect(result.diagnostics).toEqual([]);
}
