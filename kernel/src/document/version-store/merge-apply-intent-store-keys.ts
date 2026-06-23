import { canonicalJsonStringify } from './merge-apply-intent-store-json';
import type {
  MergeApplyIntentIdempotencyKey,
  MergeApplyIntentRecord,
  MergeApplyRefCasProofLookup,
} from './merge-apply-intent-store-types';
import { versionGraphNamespaceKey, type VersionGraphNamespace } from './object-store';

export function mergeApplyRefCasProofStorageKey(
  namespace: VersionGraphNamespace,
  input: MergeApplyRefCasProofLookup,
): string {
  return `${versionGraphNamespaceKey(namespace)}\u0000mergeRefCasProof\u0000${canonicalJsonStringify(input)}`;
}

export function mergeApplyIntentStorageKey(
  namespace: VersionGraphNamespace,
  idempotencyKey: MergeApplyIntentIdempotencyKey,
): string {
  return `${versionGraphNamespaceKey(namespace)}\u0000mergeApply\u0000${idempotencyKey}`;
}

export function mergeApplyIntentRecordStorageKey(record: MergeApplyIntentRecord): string {
  return `${record.namespaceKey}\u0000mergeApply\u0000${record.idempotencyKey}`;
}
