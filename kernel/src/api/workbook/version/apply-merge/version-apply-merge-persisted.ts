import type {
  VersionApplyMergeOptions,
  VersionApplyMergeResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  normalizePersistedApplyMergeInput,
  normalizePersistedApplyMergeOptions,
  validatePersistedIntentRecord,
  type NormalizedPersistedApplyMergeInput,
  type NormalizedPersistedApplyMergeOptions,
} from './version-apply-merge-persisted-admission';
import {
  applyPersistedFastForwardIntent,
  completeAlreadyMergedIntent,
} from './version-apply-merge-persisted-intent-apply';
import {
  applyPersistedMergePreviewArtifact,
  isPersistedMergePreviewArtifactInput,
} from './persisted-artifact/version-apply-merge-persisted-artifact';
import {
  blockedApplyMergeResult,
  invalidApplyMergeOptionDiagnostic,
  publicDiagnostic,
  resolutionMismatchDiagnostic,
} from './version-apply-merge-persisted-diagnostics';
import {
  lookupPersistedMergeIntentRecord,
  openPersistedMergeIntentStore,
} from './version-apply-merge-persisted-lookup';
import { resultFromTerminalIntent } from './version-apply-merge-persisted-results';

export type { NormalizedPersistedApplyMergeInput, NormalizedPersistedApplyMergeOptions };

export async function applyPersistedMergeResult(
  ctx: DocumentContext,
  input: Readonly<Record<string, unknown>>,
  options: VersionApplyMergeOptions,
): Promise<VersionApplyMergeResult> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const normalizedInput = normalizePersistedApplyMergeInput(input, diagnostics);
  const normalizedOptions = normalizePersistedApplyMergeOptions(options, diagnostics);
  if (!normalizedInput || !normalizedOptions || diagnostics.length > 0) {
    return blockedApplyMergeResult(null, null, null, diagnostics);
  }
  if (isPersistedMergePreviewArtifactInput(normalizedInput)) {
    return applyPersistedMergePreviewArtifact(ctx, normalizedInput, normalizedOptions);
  }
  if (normalizedInput.resolutions.length > 0) {
    return blockedApplyMergeResult(null, null, null, [
      resolutionMismatchDiagnostic(
        'persisted applyMerge result inputs currently support only empty resolution sets.',
      ),
    ]);
  }
  if (normalizedOptions.mode === 'preview') {
    return blockedApplyMergeResult(null, null, null, [
      invalidApplyMergeOptionDiagnostic(
        'mode',
        'persisted applyMerge result inputs are valid only in apply mode.',
      ),
    ]);
  }

  const opened = await openPersistedMergeIntentStore(ctx);
  if (!opened.ok) return blockedApplyMergeResult(null, null, null, opened.diagnostics);

  const lookup = await lookupPersistedMergeIntentRecord(opened.store, normalizedInput.resultId);
  if (!lookup.ok) return blockedApplyMergeResult(null, null, null, lookup.diagnostics);

  const record = lookup.record;
  const validationDiagnostics = validatePersistedIntentRecord(
    record,
    normalizedInput,
    normalizedOptions,
  );
  if (validationDiagnostics.length > 0) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, validationDiagnostics);
  }
  if (record.terminal) return resultFromTerminalIntent(opened.provider, record);
  if (record.applyKind === 'alreadyMerged') {
    return completeAlreadyMergedIntent(
      opened.provider,
      opened.store,
      record,
      normalizedInput.resultId,
    );
  }
  if (record.applyKind !== 'fastForward') {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, [
      publicDiagnostic(
        'VERSION_UNSUPPORTED_MERGE_ATTEMPT',
        'Persisted merge-commit result application is not wired yet.',
        { recoverability: 'unsupported' },
      ),
    ]);
  }

  return applyPersistedFastForwardIntent(
    ctx,
    opened.provider,
    opened.store,
    record,
    normalizedInput.resultId,
  );
}
