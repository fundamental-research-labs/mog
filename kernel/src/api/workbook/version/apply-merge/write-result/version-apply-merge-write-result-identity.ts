import type {
  ObjectDigest,
  VersionApplyMergeAttemptMetadata,
  VersionApplyMergeResult,
  VersionStoreDiagnostic,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import {
  invalidAppliedWriteDiagnostic,
  invalidTerminalReplayDiagnostic,
} from './version-apply-merge-write-result-diagnostics';
import type { VersionApplyMergeWritePlan } from './version-apply-merge-write-result-types';

export function appliedWriteIdentityDiagnostics(
  metadata: VersionApplyMergeAttemptMetadata,
  plan: VersionApplyMergeWritePlan,
  commit: WorkbookCommitRef | null,
  successMutationGuarantee: VersionApplyMergeResult['mutationGuarantee'],
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (successMutationGuarantee === 'ref-fast-forwarded' && commit?.id !== plan.theirs) {
    diagnostics.push(invalidAppliedWriteDiagnostic('fast-forward write commit must equal theirs.'));
  }
  if (metadata.headBefore && metadata.headBefore !== plan.ours) {
    diagnostics.push(invalidAppliedWriteDiagnostic('write result headBefore does not match ours.'));
  }
  if (metadata.headAfter && commit && metadata.headAfter !== commit.id) {
    diagnostics.push(
      invalidAppliedWriteDiagnostic('write result headAfter does not match commitRef.'),
    );
  }
  if (metadata.targetRef && commit?.refName && commit.refName !== metadata.targetRef) {
    diagnostics.push(
      invalidAppliedWriteDiagnostic('write result commitRef does not match targetRef.'),
    );
  }
  if (plan.targetRef && commit?.refName && commit.refName !== plan.targetRef) {
    diagnostics.push(
      invalidAppliedWriteDiagnostic('write result commitRef does not match the apply plan.'),
    );
  }
  if (plan.targetRef && metadata.targetRef && metadata.targetRef !== plan.targetRef) {
    diagnostics.push(
      invalidAppliedWriteDiagnostic('write result targetRef does not match the apply plan.'),
    );
  }
  if (
    plan.expectedTargetHead &&
    metadata.headBefore &&
    metadata.headBefore !== plan.expectedTargetHead.commitId
  ) {
    diagnostics.push(
      invalidAppliedWriteDiagnostic('write result headBefore does not match expectedTargetHead.'),
    );
  }
  diagnostics.push(...appliedWriteSealedPayloadDiagnostics(metadata, plan));
  return diagnostics;
}

function appliedWriteSealedPayloadDiagnostics(
  metadata: VersionApplyMergeAttemptMetadata,
  plan: VersionApplyMergeWritePlan,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  compareOptionalMetadataValue(diagnostics, metadata.resultId, plan.resultId, 'resultId');
  compareOptionalDigestValue(
    diagnostics,
    metadata.previewArtifactDigest,
    plan.previewArtifactDigest,
    'previewArtifactDigest',
  );
  compareOptionalDigestValue(diagnostics, metadata.resultDigest, plan.resultDigest, 'resultDigest');
  compareOptionalDigestValue(
    diagnostics,
    metadata.resolutionSetDigest,
    plan.resolutionSetDigest,
    'resolutionSetDigest',
  );
  compareOptionalDigestValue(
    diagnostics,
    metadata.resolvedAttemptDigest,
    plan.resolvedAttemptDigest,
    'resolvedAttemptDigest',
  );
  return diagnostics;
}

export function terminalWriteIdentityDiagnostics(
  status: unknown,
  metadata: VersionApplyMergeAttemptMetadata,
  plan: VersionApplyMergeWritePlan,
  commit: WorkbookCommitRef | null,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (status === 'alreadyMerged' && commit?.id !== plan.ours) {
    diagnostics.push(
      invalidTerminalReplayDiagnostic('alreadyMerged terminal commit must equal ours.'),
    );
  }
  if (status === 'fastForwarded' && commit?.id !== plan.theirs) {
    diagnostics.push(
      invalidTerminalReplayDiagnostic('fastForwarded terminal commit must equal theirs.'),
    );
  }
  if (metadata.headBefore && metadata.headBefore !== plan.ours) {
    diagnostics.push(
      invalidTerminalReplayDiagnostic('terminal replay headBefore does not match ours.'),
    );
  }
  if (metadata.headAfter && commit && metadata.headAfter !== commit.id) {
    diagnostics.push(
      invalidTerminalReplayDiagnostic('terminal replay headAfter does not match commitRef.'),
    );
  }
  if (metadata.targetRef && commit?.refName && commit.refName !== metadata.targetRef) {
    diagnostics.push(
      invalidTerminalReplayDiagnostic('terminal replay commitRef does not match targetRef.'),
    );
  }
  if (plan.targetRef && commit?.refName && commit.refName !== plan.targetRef) {
    diagnostics.push(
      invalidTerminalReplayDiagnostic('terminal replay commitRef does not match the apply plan.'),
    );
  }
  if (plan.targetRef && metadata.targetRef && metadata.targetRef !== plan.targetRef) {
    diagnostics.push(
      invalidTerminalReplayDiagnostic('terminal replay targetRef does not match the apply plan.'),
    );
  }
  if (
    plan.expectedTargetHead &&
    metadata.headBefore &&
    metadata.headBefore !== plan.expectedTargetHead.commitId
  ) {
    diagnostics.push(
      invalidTerminalReplayDiagnostic(
        'terminal replay headBefore does not match expectedTargetHead.',
      ),
    );
  }
  diagnostics.push(...terminalSealedPayloadDiagnostics(metadata, plan));
  return diagnostics;
}

function terminalSealedPayloadDiagnostics(
  metadata: VersionApplyMergeAttemptMetadata,
  plan: VersionApplyMergeWritePlan,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  compareMetadataValue(diagnostics, metadata.resultId, plan.resultId, 'resultId');
  compareDigestValue(
    diagnostics,
    metadata.previewArtifactDigest,
    plan.previewArtifactDigest,
    'previewArtifactDigest',
  );
  compareDigestValue(diagnostics, metadata.resultDigest, plan.resultDigest, 'resultDigest');
  compareDigestValue(
    diagnostics,
    metadata.resolutionSetDigest,
    plan.resolutionSetDigest,
    'resolutionSetDigest',
  );
  compareDigestValue(
    diagnostics,
    metadata.resolvedAttemptDigest,
    plan.resolvedAttemptDigest,
    'resolvedAttemptDigest',
  );
  return diagnostics;
}

export function blockedWriteMetadata(
  metadata: VersionApplyMergeAttemptMetadata,
  plan: VersionApplyMergeWritePlan,
  commit: WorkbookCommitRef,
): VersionApplyMergeAttemptMetadata {
  return {
    ...(metadata.resultId || plan.resultId ? { resultId: plan.resultId ?? metadata.resultId } : {}),
    ...(metadata.previewArtifactDigest || plan.previewArtifactDigest
      ? { previewArtifactDigest: plan.previewArtifactDigest ?? metadata.previewArtifactDigest }
      : {}),
    ...(metadata.resultDigest || plan.resultDigest
      ? { resultDigest: plan.resultDigest ?? metadata.resultDigest }
      : {}),
    ...(metadata.resolutionSetDigest || plan.resolutionSetDigest
      ? { resolutionSetDigest: plan.resolutionSetDigest ?? metadata.resolutionSetDigest }
      : {}),
    ...(metadata.resolvedAttemptDigest || plan.resolvedAttemptDigest
      ? { resolvedAttemptDigest: plan.resolvedAttemptDigest ?? metadata.resolvedAttemptDigest }
      : {}),
    ...(metadata.targetRef || plan.targetRef
      ? { targetRef: plan.targetRef ?? metadata.targetRef }
      : {}),
    headBefore: plan.expectedTargetHead?.commitId ?? metadata.headBefore ?? plan.ours,
    headAfter: commit.id,
    ...(metadata.applicationPlanDigest
      ? { applicationPlanDigest: metadata.applicationPlanDigest }
      : {}),
  };
}

function compareMetadataValue(
  diagnostics: VersionStoreDiagnostic[],
  actual: string | undefined,
  expected: string | undefined,
  field: string,
): void {
  if (expected === undefined) return;
  if (actual !== undefined && expected !== undefined && actual === expected) return;
  diagnostics.push(
    invalidTerminalReplayDiagnostic(`terminal replay ${field} does not match the apply plan.`),
  );
}

function compareOptionalMetadataValue(
  diagnostics: VersionStoreDiagnostic[],
  actual: string | undefined,
  expected: string | undefined,
  field: string,
): void {
  if (actual === undefined || expected === undefined || actual === expected) return;
  diagnostics.push(
    invalidAppliedWriteDiagnostic(`write result ${field} does not match the apply plan.`),
  );
}

function compareDigestValue(
  diagnostics: VersionStoreDiagnostic[],
  actual: ObjectDigest | undefined,
  expected: ObjectDigest | undefined,
  field: string,
): void {
  if (expected === undefined) return;
  if (actual !== undefined && expected !== undefined && digestsEqual(actual, expected)) return;
  diagnostics.push(
    invalidTerminalReplayDiagnostic(`terminal replay ${field} does not match the apply plan.`),
  );
}

function compareOptionalDigestValue(
  diagnostics: VersionStoreDiagnostic[],
  actual: ObjectDigest | undefined,
  expected: ObjectDigest | undefined,
  field: string,
): void {
  if (actual === undefined || expected === undefined || digestsEqual(actual, expected)) return;
  diagnostics.push(
    invalidAppliedWriteDiagnostic(`write result ${field} does not match the apply plan.`),
  );
}

function digestsEqual(left: ObjectDigest, right: ObjectDigest): boolean {
  return (
    left.algorithm === right.algorithm &&
    left.digest === right.digest &&
    left.byteLength === right.byteLength
  );
}
