import type {
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResult,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  alreadyMergedApplyMergeResult,
  plannedAncestryApplyMergeResult,
} from './version/apply-merge/version-apply-merge-ancestry';
import {
  finalizeApplyMergePlan,
  tryApplyFastForwardMerge,
  validateApplyModeTargetRefCasProof,
} from './version/apply-merge/version-apply-merge-orchestration';
import { applyPersistedMergeResult } from './version/apply-merge/version-apply-merge-persisted';
import {
  applyMergeServiceUnavailableDiagnostic,
  blockedApplyMergeResult,
  resolutionMismatchDiagnostic,
  resultFromTargetRefCasFailure,
} from './version/apply-merge/version-apply-merge-results';
import { planResolvedConflicts } from './version/apply-merge/version-apply-merge-resolution-plan';
import {
  isApplyMergePersistedInput,
  validateApplyMergeRequest,
} from './version/apply-merge/version-apply-merge-validation';
import { mergeWorkbookVersion } from './version-merge';
import {
  getVersionMergeCapabilityDecision,
  versionMergeCapabilityDisabledDiagnostic,
} from './version/merge/version-merge-capability';
import { materializableMergePlanDiagnostics } from './version/merge/version-merge-materializer-support';
import { validateVersionDomainSupportManifestGate } from './version/domain-support/version-domain-support-gate';

export async function applyMergeWorkbookVersion(
  ctx: DocumentContext,
  input: VersionApplyMergeInput,
  options: VersionApplyMergeOptions = {},
): Promise<VersionApplyMergeResult> {
  const capability = getVersionMergeCapabilityDecision(ctx, 'version:mergeApply');
  if (!capability.enabled) {
    return blockedApplyMergeResult(null, null, null, [
      versionMergeCapabilityDisabledDiagnostic('applyMerge', capability),
    ]);
  }

  if (isApplyMergePersistedInput(input)) {
    const gateDiagnostics = await validateVersionDomainSupportManifestGate(ctx, 'applyMerge');
    if (gateDiagnostics.length > 0) {
      return blockedApplyMergeResult(null, null, null, gateDiagnostics);
    }
    return applyPersistedMergeResult(ctx, input, options);
  }

  const validated = validateApplyMergeRequest(input, options);
  if (!validated.ok) {
    return blockedApplyMergeResult(
      validated.base,
      validated.ours,
      validated.theirs,
      validated.diagnostics,
    );
  }

  const gateDiagnostics = await validateVersionDomainSupportManifestGate(ctx, 'applyMerge');
  if (gateDiagnostics.length > 0) {
    return blockedApplyMergeResult(
      validated.mergeInput.base,
      validated.mergeInput.ours,
      validated.mergeInput.theirs,
      gateDiagnostics,
    );
  }

  if (validated.applyOptions.mode === 'apply' && validated.resolutions.length === 0) {
    const fastForward = await tryApplyFastForwardMerge(
      ctx,
      validated.mergeInput,
      validated.applyOptions,
    );
    if (fastForward.kind !== 'not-fast-forward') return fastForward.result;
  }

  const preview = await mergeWorkbookVersion(ctx, validated.mergeInput, validated.previewOptions);
  if (preview.status === 'blocked') {
    return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, preview.diagnostics);
  }

  if (preview.status === 'clean') {
    if (validated.resolutions.length > 0) {
      return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
        resolutionMismatchDiagnostic('clean merge previews do not accept conflict resolutions.'),
      ]);
    }
    return finalizeApplyMergePlan(ctx, validated.applyOptions, {
      base: preview.base,
      ours: preview.ours,
      theirs: preview.theirs,
      changes: preview.changes,
      resolutionCount: 0,
    });
  }

  if (preview.status === 'fastForward' || preview.status === 'alreadyMerged') {
    if (validated.resolutions.length > 0) {
      return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
        resolutionMismatchDiagnostic('ancestry merge previews do not accept conflict resolutions.'),
      ]);
    }
    if (validated.applyOptions.mode === 'preview') {
      return plannedAncestryApplyMergeResult(preview);
    }
    if (preview.status === 'alreadyMerged') {
      const cas = await validateApplyModeTargetRefCasProof(ctx, validated.applyOptions);
      if (!cas.ok) {
        return resultFromTargetRefCasFailure(preview.base, preview.ours, preview.theirs, cas);
      }
      return alreadyMergedApplyMergeResult({ ...preview, ...validated.applyOptions });
    }
    return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
      applyMergeServiceUnavailableDiagnostic(),
    ]);
  }

  if (validated.resolutions.length === 0) {
    const supportDiagnostics = materializableMergePlanDiagnostics(
      { changes: preview.changes, conflicts: preview.conflicts },
      'applyMerge',
    );
    if (supportDiagnostics.length > 0) {
      return blockedApplyMergeResult(
        preview.base,
        preview.ours,
        preview.theirs,
        supportDiagnostics,
      );
    }
    if (validated.applyOptions.mode === 'apply') {
      return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
        resolutionMismatchDiagnostic(
          'applyMerge apply mode requires resolutions for conflicted previews.',
        ),
      ]);
    }

    return {
      status: 'conflicted',
      base: preview.base,
      ours: preview.ours,
      theirs: preview.theirs,
      changes: preview.changes,
      conflicts: preview.conflicts,
      diagnostics: [],
      requiredResolutionCount: preview.conflicts.length,
      mutationGuarantee: 'preview-only',
    };
  }

  if (validated.resolutions.some((resolution) => resolution.sealedPayloadRef)) {
    return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
      resolutionMismatchDiagnostic(
        'sealed resolution payload refs require a persisted merge preview artifact.',
      ),
    ]);
  }

  const plan = planResolvedConflicts(preview.conflicts, validated.resolutions);
  if (!plan.ok) {
    return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, plan.diagnostics);
  }

  return finalizeApplyMergePlan(ctx, validated.applyOptions, {
    base: preview.base,
    ours: preview.ours,
    theirs: preview.theirs,
    changes: [...preview.changes, ...plan.changes],
    resolutionCount: validated.resolutions.length,
  });
}
