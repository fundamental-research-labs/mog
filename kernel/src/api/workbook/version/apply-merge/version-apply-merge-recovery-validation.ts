import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeResultId,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  computeMergeApplyRefCasProof,
  idempotencyKeyForResolvedAttempt,
  intentIdForMergeResultId,
  intentIdForResolvedAttemptDigest,
  type MergeApplyIntentApplyKind,
  type MergeApplyIntentId,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
  type MergeApplyRefCasProof,
} from '../../../../document/version-store/merge-apply-intent-store';
import type { ObjectDigest as StoreObjectDigest } from '../../../../document/version-store/object-digest';
import type { VersionGraphStore } from '../../../../document/version-store/provider-graph-store';
import {
  digestsEqual,
  intentStoreDiagnostics,
  invalidRecoveryInputDiagnostic,
  isObjectDigest,
  mapProviderDiagnostics,
  providerErrorDiagnostic,
  recoveryOperationIdentityMismatchDiagnostic,
  refCasProofMismatchDiagnostic,
  staleTargetHeadDiagnostic,
} from './version-apply-merge-recovery-diagnostics';
import { publicResultId } from './version-apply-merge-recovery-results';

export type RecoverPersistedMergeApplyPostCasInput = {
  readonly resultId?: VersionMergeResultId;
  readonly resolvedAttemptDigest?: ObjectDigest;
  readonly resultDigest?: ObjectDigest;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
};

export type RecoveryIntentIdentityResult =
  | { readonly ok: true; readonly intentId: MergeApplyIntentId }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export type MergeCommitIdentityResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly staleTargetHead: boolean;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export async function readAndValidateRefCasProof(
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
  applyKind: Extract<MergeApplyIntentApplyKind, 'fastForward' | 'mergeCommit'>,
  headAfter: WorkbookCommitId,
): Promise<
  | { readonly ok: true; readonly proof: MergeApplyRefCasProof }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const read = await store.readRefCasProof({
    applyKind,
    targetRef: record.targetRef,
    headBefore: record.ours,
    headAfter,
  });
  if (read.status !== 'found') {
    return { ok: false, diagnostics: intentStoreDiagnostics(read.diagnostics) };
  }
  const expected = await computeMergeApplyRefCasProof({
    applyKind,
    targetRef: record.targetRef,
    headBefore: record.ours,
    headAfter,
  });
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (read.proof.applyKind !== applyKind) {
    diagnostics.push(refCasProofMismatchDiagnostic('ref CAS proof apply kind does not match.'));
  }
  if (!digestsEqual(read.proof.commitMetadataDigest, expected.commitMetadataDigest)) {
    diagnostics.push(
      refCasProofMismatchDiagnostic('ref CAS proof commit metadata does not match.'),
    );
  }
  if (!digestsEqual(read.proof.refUpdateMetadataDigest, expected.refUpdateMetadataDigest)) {
    diagnostics.push(refCasProofMismatchDiagnostic('ref CAS proof ref update does not match.'));
  }
  if (!digestsEqual(read.proof.refLogEventDigest, expected.refLogEventDigest)) {
    diagnostics.push(refCasProofMismatchDiagnostic('ref CAS proof event log does not match.'));
  }
  return diagnostics.length === 0 ? { ok: true, proof: read.proof } : { ok: false, diagnostics };
}

export async function validateMergeCommitIdentity(
  graph: VersionGraphStore,
  record: MergeApplyIntentRecord,
  commitId: WorkbookCommitId,
): Promise<MergeCommitIdentityResult> {
  try {
    const read = await graph.readCommit(commitId);
    if (read.status !== 'success') {
      return {
        ok: false,
        staleTargetHead: false,
        diagnostics: mapProviderDiagnostics(read.diagnostics),
      };
    }
    const payload = read.commit.payload;
    if (
      payload.parentCommitIds.length !== 2 ||
      payload.parentCommitIds[0] !== record.ours ||
      payload.parentCommitIds[1] !== record.theirs
    ) {
      return { ok: false, staleTargetHead: true, diagnostics: [staleTargetHeadDiagnostic()] };
    }
    if (
      !payload.resolvedMergeAttemptDigest ||
      !digestsEqual(payload.resolvedMergeAttemptDigest, record.resolvedAttemptDigest)
    ) {
      return {
        ok: false,
        staleTargetHead: false,
        diagnostics: [
          recoveryOperationIdentityMismatchDiagnostic(
            'Current target head is bound to another merge attempt.',
          ),
        ],
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, staleTargetHead: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

export function recoveryIntentIdentityFromInput(
  input: RecoverPersistedMergeApplyPostCasInput,
): RecoveryIntentIdentityResult {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const resolvedAttemptIntentId = input.resolvedAttemptDigest
    ? isObjectDigest(input.resolvedAttemptDigest)
      ? intentIdForResolvedAttemptDigest(input.resolvedAttemptDigest as StoreObjectDigest)
      : null
    : null;
  const resultIntentId = input.resultId ? intentIdForMergeResultId(input.resultId) : null;

  if (input.resolvedAttemptDigest && !resolvedAttemptIntentId) {
    diagnostics.push(invalidRecoveryInputDiagnostic('resolvedAttemptDigest is invalid.'));
  }
  if (input.resultId && !resultIntentId) {
    diagnostics.push(invalidRecoveryInputDiagnostic('resultId is invalid.'));
  }
  if (resolvedAttemptIntentId && resultIntentId && resolvedAttemptIntentId !== resultIntentId) {
    diagnostics.push(
      recoveryOperationIdentityMismatchDiagnostic(
        'recovery resultId does not match resolvedAttemptDigest.',
      ),
    );
  }
  const intentId = resolvedAttemptIntentId ?? resultIntentId;
  if (!intentId && diagnostics.length === 0) {
    diagnostics.push(
      invalidRecoveryInputDiagnostic(
        'Recovery input must identify an existing merge apply intent.',
      ),
    );
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, intentId: intentId as MergeApplyIntentId };
}

export function validateRecoveryInput(
  record: MergeApplyIntentRecord,
  input: RecoverPersistedMergeApplyPostCasInput,
  expectedIntentId: MergeApplyIntentId,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (
    record.intentId !== expectedIntentId ||
    record.intentId !== expectedIntentIdForRecord(record)
  ) {
    diagnostics.push(
      recoveryOperationIdentityMismatchDiagnostic('recovery intent id does not match.'),
    );
  }
  const expectedIdempotencyKey = expectedIdempotencyKeyForRecoveryInput(record, input);
  if (expectedIdempotencyKey && record.idempotencyKey !== expectedIdempotencyKey) {
    diagnostics.push(
      recoveryOperationIdentityMismatchDiagnostic('recovery idempotency key does not match.'),
    );
  }
  if (!publicResultIdMatchesInput(record, input.resultId)) {
    diagnostics.push(
      recoveryOperationIdentityMismatchDiagnostic('recovery resultId does not match the intent.'),
    );
  }
  if (input.resolvedAttemptDigest) {
    if (!digestsEqual(record.resolvedAttemptDigest, input.resolvedAttemptDigest)) {
      diagnostics.push(
        refCasProofMismatchDiagnostic('recovery resolvedAttemptDigest does not match.'),
      );
    }
  }
  if (input.resultDigest && !digestsEqual(record.resultDigest, input.resultDigest)) {
    diagnostics.push(refCasProofMismatchDiagnostic('recovery resultDigest does not match.'));
  }
  if (
    input.resolutionSetDigest &&
    !digestsEqual(record.resolutionSetDigest, input.resolutionSetDigest)
  ) {
    diagnostics.push(refCasProofMismatchDiagnostic('recovery resolutionSetDigest does not match.'));
  }
  if (input.targetRef && record.targetRef !== input.targetRef) {
    diagnostics.push(refCasProofMismatchDiagnostic('recovery targetRef does not match.'));
  }
  if (
    input.expectedTargetHead &&
    JSON.stringify(record.expectedTargetHead) !== JSON.stringify(input.expectedTargetHead)
  ) {
    diagnostics.push(refCasProofMismatchDiagnostic('recovery expectedTargetHead does not match.'));
  }
  return diagnostics;
}

function expectedIntentIdForRecord(record: MergeApplyIntentRecord): MergeApplyIntentId {
  return intentIdForResolvedAttemptDigest(record.resolvedAttemptDigest);
}

function expectedIdempotencyKeyForRecoveryInput(
  record: MergeApplyIntentRecord,
  input: RecoverPersistedMergeApplyPostCasInput,
) {
  if (!input.targetRef || !input.expectedTargetHead) return null;
  return idempotencyKeyForResolvedAttempt({
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    targetRef: input.targetRef,
    expectedTargetHead: input.expectedTargetHead,
  });
}

function publicResultIdMatchesInput(
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId | undefined,
): boolean {
  if (!resultId) return true;
  return publicResultId(record) === resultId;
}
