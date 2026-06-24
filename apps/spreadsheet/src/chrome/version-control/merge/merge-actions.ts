import type {
  VersionApplyMergeOptions,
  VersionApplyMergeInput,
  VersionApplyMergeResolution,
  VersionApplyMergeResult,
  VersionCommitExpectedHead,
  VersionMergeInput,
  VersionMergeResult,
  VersionRef,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitSummary,
  WorkbookVersion,
} from '@mog-sdk/contracts/api';

import type { VersionPanelDiagnostic } from '../VersionActionStatus';
import { shortCommitId } from '../version-history-format';
import {
  readVersionResult,
  type VersionHistoryData,
  type VersionHistoryWorkbook,
} from '../version-history-panel-data';
import type { VersionMergeTarget } from './version-merge-planning';

const MERGE_GRAPH_PAGE_SIZE = 100;

export type VersionMergePreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'blocked'; readonly message: string }
  | {
      readonly kind: 'result';
      readonly input: VersionMergeInput;
      readonly result: VersionMergeResult;
      readonly sourceRefName: string;
      readonly targetRefName?: string;
    };

export type VersionMergeResolutionSelections = Readonly<Record<string, string>>;

export function mergePreviewActionDisabledReason(
  availabilityReason: string | undefined,
  currentTarget: VersionMergeTarget | undefined,
  selectedSource: VersionRef | undefined,
): string | undefined {
  if (availabilityReason) return availabilityReason;
  if (!currentTarget) return 'Current head is unavailable.';
  if (!selectedSource) return 'Choose a source branch or ref.';
  return undefined;
}

export function mergeApplyActionDisabledReason(
  availabilityReason: string | undefined,
  currentTarget: VersionMergeTarget | undefined,
  selectedSource: VersionRef | undefined,
  previewState: VersionMergePreviewState,
  selections: VersionMergeResolutionSelections,
): string | undefined {
  if (availabilityReason) return availabilityReason;
  if (!currentTarget?.refName) return 'Current branch ref is unavailable.';
  if (previewState.kind === 'idle') return 'Preview a merge first.';
  if (previewState.kind === 'blocked') return 'Resolve the blocked preview before applying.';

  const { result } = previewState;
  if (
    previewState.input.ours !== currentTarget.commitId ||
    previewState.targetRefName !== currentTarget.refName ||
    !selectedSource ||
    previewState.input.theirs !== selectedSource.commitId ||
    previewState.sourceRefName !== selectedSource.name
  ) {
    return 'Preview this merge again before applying.';
  }
  if (result.status === 'blocked') return mergeBlockedMessage(result.diagnostics);
  if (result.attemptKind === 'reviewOnly') return 'This merge preview is review-only.';
  if (result.status === 'conflicted' && !mergeConflictsResolved(result, selections)) {
    return 'Select a resolution for each conflict.';
  }
  return undefined;
}

export async function readMergeGraph(
  workbook: VersionHistoryWorkbook,
  data: VersionHistoryData,
  starts: readonly WorkbookCommitId[],
): Promise<
  | { readonly ok: true; readonly commits: readonly WorkbookCommitSummary[] }
  | { readonly ok: false; readonly diagnostic: VersionPanelDiagnostic }
> {
  const reads = await Promise.all(
    starts.map((from) =>
      readVersionResult('VERSION_UI_MERGE_HISTORY_FAILED', () =>
        workbook.version.listCommits({
          from,
          pageSize: MERGE_GRAPH_PAGE_SIZE,
          includeDiagnostics: true,
        }),
      ),
    ),
  );
  const failed = reads.find(
    (read): read is Extract<(typeof reads)[number], { readonly ok: false }> => !read.ok,
  );
  if (failed) return { ok: false, diagnostic: failed.diagnostic };

  const byId = new Map<WorkbookCommitId, WorkbookCommitSummary>();
  for (const commit of data.commits) byId.set(commit.id, commit);
  for (const read of reads) {
    if (!read.ok) continue;
    for (const commit of read.value.items) byId.set(commit.id, commit);
  }
  return { ok: true, commits: [...byId.values()] };
}

export function mergeExpectedTargetHead(
  data: VersionHistoryData,
): Pick<NonNullable<Parameters<WorkbookVersion['merge']>[1]>, 'expectedTargetHead'> {
  return data.head?.id && data.head.refRevision
    ? { expectedTargetHead: { commitId: data.head.id, revision: data.head.refRevision } }
    : {};
}

export function materializedActiveCheckoutMergeApplyOptions(
  targetRef: NonNullable<VersionMergeTarget['refName']>,
  expectedTargetHead: VersionCommitExpectedHead,
): Pick<
  VersionApplyMergeOptions,
  'mode' | 'targetRef' | 'expectedTargetHead' | 'includeDiagnostics' | 'materializeActiveCheckout'
> {
  return {
    mode: 'apply',
    includeDiagnostics: true,
    materializeActiveCheckout: true,
    targetRef,
    expectedTargetHead,
  };
}

export function applyMergeInputFromPreview(
  result: VersionMergeResult,
  selections: VersionMergeResolutionSelections,
): VersionApplyMergeInput | undefined {
  if (result.status === 'blocked') return undefined;

  const resolutions =
    result.status === 'conflicted' ? mergeConflictResolutions(result, selections) : [];
  const resolutionPayload = resolutions.length > 0 ? { resolutions } : {};

  if (result.resultId && result.resultDigest) {
    return {
      resultId: result.resultId,
      resultDigest: result.resultDigest,
      ...(result.previewArtifactDigest
        ? { previewArtifactDigest: result.previewArtifactDigest }
        : {}),
      ...(result.resolutionSetDigest ? { resolutionSetDigest: result.resolutionSetDigest } : {}),
      ...(result.resolvedAttemptDigest
        ? { resolvedAttemptDigest: result.resolvedAttemptDigest }
        : {}),
      ...resolutionPayload,
    };
  }

  return {
    base: result.base,
    ours: result.ours,
    theirs: result.theirs,
    ...resolutionPayload,
  };
}

export function mergePreviewActionMessage(result: VersionMergeResult): string {
  if (result.status === 'clean') {
    return `Merge preview clean with ${formatCount(result.changes.length, 'change')}`;
  }
  if (result.status === 'conflicted') {
    return `Merge preview has ${formatCount(result.conflicts.length, 'conflict')}`;
  }
  if (result.status === 'fastForward') return 'Merge preview can fast-forward';
  if (result.status === 'alreadyMerged') return 'Source is already merged';
  return 'Merge preview blocked';
}

export function mergeApplyActionMessage(result: VersionApplyMergeResult): string {
  if (result.status === 'applied') return `Merge applied at ${shortCommitId(result.commitRef.id)}`;
  if (result.status === 'fastForwarded') {
    return `Fast-forwarded to ${shortCommitId(result.commitRef.id)}`;
  }
  if (result.status === 'alreadyApplied') return 'Merge was already applied';
  if (result.status === 'alreadyMerged') return 'Source was already merged';
  if (result.status === 'planned') return 'Merge apply planned';
  return 'Merge apply finished';
}

export function mergeApplyBlocked(result: VersionApplyMergeResult): boolean {
  return result.status === 'blocked' || result.status === 'staleTargetHead';
}

export function mergeApplyBlockedMessage(result: VersionApplyMergeResult): string {
  if (result.status === 'staleTargetHead') {
    return mergeBlockedMessage(result.diagnostics, 'Current branch moved. Refresh before merging.');
  }
  if (result.status === 'blocked') return mergeBlockedMessage(result.diagnostics);
  return 'Merge apply was blocked.';
}

export function mergeApplyConflictedMessage(): string {
  return 'Merge still has unresolved conflicts. Refresh the preview and resolve again.';
}

export function diagnosticFromMergeApplyResult(
  code: string,
  result: VersionApplyMergeResult,
): VersionPanelDiagnostic {
  return {
    code,
    severity: panelSeverity(result.diagnostics[0]?.severity ?? 'warning'),
    message: mergeApplyBlockedMessage(result),
  };
}

function mergeConflictResolutions(
  result: Extract<VersionMergeResult, { readonly status: 'conflicted' }>,
  selections: VersionMergeResolutionSelections,
): readonly VersionApplyMergeResolution[] {
  return result.conflicts
    .map((conflict) => {
      const optionId = selections[conflict.conflictId];
      const option = conflict.resolutionOptions.find(
        (candidate) => candidate.optionId === optionId,
      );
      if (!option) return undefined;
      return {
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflict.conflictDigest,
        optionId: option.optionId,
        kind: option.kind,
      };
    })
    .filter((resolution): resolution is VersionApplyMergeResolution => Boolean(resolution));
}

function mergeConflictsResolved(
  result: Extract<VersionMergeResult, { readonly status: 'conflicted' }>,
  selections: VersionMergeResolutionSelections,
): boolean {
  return result.conflicts.every((conflict) =>
    conflict.resolutionOptions.some(
      (option) => option.optionId === selections[conflict.conflictId],
    ),
  );
}

function mergeBlockedMessage(
  diagnostics: readonly VersionStoreDiagnostic[],
  fallback = 'Merge was blocked.',
): string {
  return (
    diagnostics.find((diagnostic) => diagnostic.safeMessage.trim().length > 0)?.safeMessage ??
    fallback
  );
}

function panelSeverity(
  severity: VersionStoreDiagnostic['severity'],
): VersionPanelDiagnostic['severity'] {
  return severity === 'fatal' ? 'error' : severity;
}

function formatCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}
