import type {
  VersionApplyMergeResult,
  VersionMergeResultId,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  computeMergeApplyRefCasProof,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
  type MergeApplyRefCasProof,
} from '../../../../document/version-store/merge-apply-intent-store';
import type { VersionStoreProvider } from '../../../../document/version-store/provider';
import { digestsEqual } from './version-apply-merge-persisted-admission';
import {
  applyMergeServiceUnavailableDiagnostic,
  blockedApplyMergeResult,
  intentStoreDiagnostics,
  providerErrorDiagnostic,
  resolutionMismatchDiagnostic,
} from './version-apply-merge-persisted-diagnostics';
import {
  getAttachedVersionApplyMergeService,
  readCurrentTargetHead,
} from './version-apply-merge-persisted-lookup';
import {
  alreadyMergedPersistedResult,
  fastForwardedPersistedResult,
  persistedMetadata,
  persistedPlan,
  resultFromTerminalIntent,
  resultIfTargetMoved,
} from './version-apply-merge-persisted-results';
import {
  isApplyMergeWriteSuccessResult,
  isNonFastForwardWriteResult,
  mapApplyMergeWriteResult,
} from './write-result/version-apply-merge-write-result';

export async function completeAlreadyMergedIntent(
  provider: VersionStoreProvider,
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
): Promise<VersionApplyMergeResult> {
  const stale = await resultIfTargetMoved(provider, record, resultId, record.ours);
  if (stale) return stale;

  const completed = await store.completeIntent({
    intentId: record.intentId,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    completedAt: new Date().toISOString(),
    terminal: {
      status: 'alreadyMerged',
      headBefore: record.ours,
      headAfter: record.ours,
      commitId: record.ours,
    },
  });
  if (completed.status !== 'completed') {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      intentStoreDiagnostics(completed.diagnostics),
      'unknown-after-crash',
    );
  }
  return alreadyMergedPersistedResult(completed.record, resultId);
}

export async function applyPersistedFastForwardIntent(
  ctx: DocumentContext,
  provider: VersionStoreProvider,
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
): Promise<VersionApplyMergeResult> {
  try {
    const recovered = await completeFastForwardIntentIfAlreadyApplied(
      provider,
      store,
      record,
      resultId,
    );
    if (recovered) return recovered;
    const staleBeforeWrite = await resultIfTargetMoved(provider, record, resultId, record.ours);
    if (staleBeforeWrite) return staleBeforeWrite;

    const service = getAttachedVersionApplyMergeService(ctx);
    if (!service?.fastForwardMerge) {
      return blockedApplyMergeResult(record.base, record.ours, record.theirs, [
        applyMergeServiceUnavailableDiagnostic(),
      ]);
    }

    const raw = await service.fastForwardMerge({
      base: record.base,
      ours: record.ours,
      theirs: record.theirs,
      targetRef: record.targetRef,
      expectedTargetHead: record.expectedTargetHead,
    });
    if (isNonFastForwardWriteResult(raw)) {
      return blockedApplyMergeResult(record.base, record.ours, record.theirs, [
        resolutionMismatchDiagnostic('persisted merge attempt is not a fast-forward.'),
      ]);
    }
    const mapped = mapApplyMergeWriteResult(
      raw,
      persistedPlan(record, resultId),
      'ref-fast-forwarded',
    );
    if (!isApplyMergeWriteSuccessResult(mapped)) return mapped;
    const commitRef = 'commitRef' in mapped ? mapped.commitRef : null;
    if (!commitRef) return mapped;

    const completed = await completeFastForwardIntent(store, record, commitRef.id);
    if (completed.status !== 'completed') {
      return {
        ...persistedMetadata(record, resultId),
        headAfter: commitRef.id,
        ...blockedApplyMergeResult(
          record.base,
          record.ours,
          record.theirs,
          intentStoreDiagnostics(completed.diagnostics),
          'unknown-after-crash',
        ),
      };
    }
    return fastForwardedPersistedResult(completed.record, resultId, commitRef);
  } catch {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, [
      providerErrorDiagnostic(),
    ]);
  }
}

async function completeFastForwardIntentIfAlreadyApplied(
  provider: VersionStoreProvider,
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
): Promise<VersionApplyMergeResult | null> {
  const current = await readCurrentTargetHead(provider, record);
  if (!current.ok || current.commitId !== record.theirs) return null;

  const proofRead = await store.readRefCasProof({
    applyKind: 'fastForward',
    targetRef: record.targetRef,
    headBefore: record.ours,
    headAfter: record.theirs,
  });
  if (proofRead.status !== 'found') {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      intentStoreDiagnostics(proofRead.diagnostics),
      'ref-not-mutated',
    );
  }

  const proofDiagnostics = await validateFastForwardRefCasProof(record, proofRead.proof);
  if (proofDiagnostics.length > 0) {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      proofDiagnostics,
      'ref-not-mutated',
    );
  }

  const completed = await completeFastForwardIntent(store, record, record.theirs, proofRead.proof);
  if (completed.status !== 'completed') {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      intentStoreDiagnostics(completed.diagnostics),
      'ref-not-mutated',
    );
  }

  return resultFromTerminalIntent(provider, completed.record);
}

function completeFastForwardIntent(
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
  commitId: WorkbookCommitId,
  refCasProof?: MergeApplyRefCasProof,
) {
  return store.completeIntent({
    intentId: record.intentId,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    completedAt: new Date().toISOString(),
    terminal: {
      status: 'fastForwarded',
      headBefore: record.ours,
      headAfter: commitId,
      commitId,
      ...(refCasProof ? { refCasProof } : {}),
    },
  });
}

async function validateFastForwardRefCasProof(
  record: MergeApplyIntentRecord,
  proof: MergeApplyRefCasProof,
): Promise<readonly VersionStoreDiagnostic[]> {
  const expected = await computeMergeApplyRefCasProof({
    applyKind: 'fastForward',
    targetRef: record.targetRef,
    headBefore: record.ours,
    headAfter: record.theirs,
  });
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (proof.applyKind !== 'fastForward') {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge ref CAS proof apply kind does not match.'),
    );
  }
  if (!digestsEqual(proof.commitMetadataDigest, expected.commitMetadataDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge ref CAS proof commit metadata does not match.'),
    );
  }
  if (!digestsEqual(proof.refUpdateMetadataDigest, expected.refUpdateMetadataDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge ref CAS proof ref update does not match.'),
    );
  }
  if (!digestsEqual(proof.refLogEventDigest, expected.refLogEventDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge ref CAS proof event log does not match.'),
    );
  }
  return diagnostics;
}
