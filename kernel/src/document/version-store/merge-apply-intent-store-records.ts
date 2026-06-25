import type { ObjectDigest } from './object-digest';
import { canonicalJsonStringify, cloneJson, isRecord } from './merge-apply-intent-store-json';
import type {
  MergeApplyIntentRecord,
  MergeApplyIntentStoreProvider,
} from './merge-apply-intent-store-types';

export function cloneIntent(record: MergeApplyIntentRecord): MergeApplyIntentRecord;
export function cloneIntent(record: undefined): undefined;
export function cloneIntent(
  record: MergeApplyIntentRecord | undefined,
): MergeApplyIntentRecord | undefined;
export function cloneIntent(
  record: MergeApplyIntentRecord | undefined,
): MergeApplyIntentRecord | undefined {
  return record === undefined ? undefined : cloneJson(record);
}

export function intentsEquivalent(
  left: MergeApplyIntentRecord,
  right: MergeApplyIntentRecord,
): boolean {
  return (
    canonicalJsonStringify(intentIdentity(left)) === canonicalJsonStringify(intentIdentity(right))
  );
}

export function objectDigestsEqual(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

export function mergeApplyIntentTerminalsEqual(
  left: NonNullable<MergeApplyIntentRecord['terminal']>,
  right: NonNullable<MergeApplyIntentRecord['terminal']>,
): boolean {
  return (
    left.status === right.status &&
    left.headBefore === right.headBefore &&
    left.headAfter === right.headAfter &&
    left.commitId === right.commitId &&
    canonicalJsonStringify(left.refCasProof ?? null) ===
      canonicalJsonStringify(right.refCasProof ?? null)
  );
}

export function hasMergeApplyIntentStoreProvider(
  value: unknown,
): value is MergeApplyIntentStoreProvider {
  return isRecord(value) && typeof value.openMergeApplyIntentStore === 'function';
}

export function isMergeApplyIntentRecord(value: unknown): value is MergeApplyIntentRecord {
  return isRecord(value) && value.schemaVersion === 1 && value.recordKind === 'mergeApplyIntent';
}

function intentIdentity(record: MergeApplyIntentRecord) {
  return {
    schemaVersion: record.schemaVersion,
    recordKind: record.recordKind,
    intentId: record.intentId,
    idempotencyKey: record.idempotencyKey,
    namespaceKey: record.namespaceKey,
    documentScopeKey: record.documentScopeKey,
    applyKind: record.applyKind,
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    targetRef: record.targetRef,
    expectedTargetHead: record.expectedTargetHead,
    resultDigest: record.resultDigest,
    resolutionSetDigest: record.resolutionSetDigest,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
  };
}
