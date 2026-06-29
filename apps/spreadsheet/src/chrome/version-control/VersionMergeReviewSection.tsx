import type {
  VersionDiffValue,
  VersionMergeConflictResolutionOptionKind,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  DisabledReason,
  safeDomId,
  sanitizeVersionStatusText,
} from './availability/version-action-availability';
import { displayBranchName } from './version-branch-name';
import type { VersionMergeReviewPanelState } from './version-history-panel-actions';

export function MergeReviewSection({
  state,
  applyEnabled,
  applyDisabledReason,
  onChooseResolution,
  onApply,
}: {
  readonly state: VersionMergeReviewPanelState;
  readonly applyEnabled: boolean;
  readonly applyDisabledReason?: string;
  readonly onChooseResolution: (
    conflictId: string,
    kind: VersionMergeConflictResolutionOptionKind,
  ) => void;
  readonly onApply: () => void;
}): React.JSX.Element {
  const review = state.review;
  const sourceLabel = displayBranchName(state.sourceRef.name);
  const applyReasonId = 'version-merge-apply-disabled-reason';
  const unresolvedConflictCount = review.conflicts.filter(
    (conflict) =>
      !review.selectedResolutions.some(
        (resolution) => resolution.conflictId === conflict.conflictId,
      ),
  ).length;
  const applyStatus =
    unresolvedConflictCount > 0
      ? `Resolve ${unresolvedConflictCount} conflicts before applying.`
      : (sanitizeVersionStatusText(applyDisabledReason, 'Merge apply is unavailable.') ??
        'Merge apply is unavailable.');
  const canApply = applyEnabled && unresolvedConflictCount === 0 && review.status !== 'blocked';
  const statusText = mergeReviewStatusText(review.status, review.conflicts.length);
  const diagnostics = review.diagnostics
    .map((diagnostic) => mergeDiagnosticText(diagnostic))
    .filter((message): message is string => Boolean(message));

  return (
    <section
      className="flex flex-col gap-2 rounded-sm border border-ss-border bg-ss-surface-secondary p-3"
      aria-label="Merge"
      data-testid="version-history-merge-preview"
      data-status={review.status}
      data-change-count={review.changes.length}
      data-conflict-count={review.conflicts.length}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-body-sm font-semibold text-ss-text">Merge</div>
          <div className="truncate text-[11px] text-ss-text-secondary">Source {sourceLabel}</div>
        </div>
        <div className="shrink-0 text-[11px] font-medium text-ss-text-secondary" role="status">
          {statusText}
        </div>
      </div>

      {review.conflicts.length > 0 ? (
        <div className="flex flex-col gap-2">
          {review.conflicts.map((conflict, index) => {
            const selected = review.selectedResolutions.find(
              (resolution) => resolution.conflictId === conflict.conflictId,
            );
            const groupName = `version-merge-resolution-${safeDomId(conflict.conflictId)}`;
            return (
              <fieldset
                key={conflict.conflictId}
                className="rounded-sm border border-ss-border bg-ss-surface p-2"
              >
                <legend className="px-1 text-[11px] font-medium text-ss-text-secondary">
                  Conflict {index + 1}
                </legend>
                <div className="flex flex-col gap-1">
                  {conflict.resolutionOptions.map((option) => {
                    const optionLabel = mergeResolutionOptionLabel(option.kind);
                    const valueLabel = formatMergeDiffValue(option.value);
                    const inputId = `${groupName}-${option.kind}`;
                    return (
                      <label
                        key={option.optionId}
                        htmlFor={inputId}
                        className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-body-sm text-ss-text hover:bg-ss-surface-hover"
                      >
                        <input
                          id={inputId}
                          data-testid={`version-merge-resolution-${safeDomId(
                            conflict.conflictId,
                          )}-${option.kind}`}
                          type="radio"
                          name={groupName}
                          checked={selected?.kind === option.kind}
                          onChange={() => onChooseResolution(conflict.conflictId, option.kind)}
                        />
                        <span className="min-w-0 truncate">
                          {optionLabel} - {valueLabel}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>
      ) : null}

      {diagnostics.length > 0 ? (
        <div
          className="rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-[11px] text-ss-text-secondary"
          data-testid="version-history-merge-diagnostics"
        >
          {diagnostics.map((message, index) => (
            <div key={`${message}-${index}`}>{message}</div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          data-testid="version-history-merge-apply-button"
          data-capability="version:mergeApply"
          onClick={onApply}
          disabled={!canApply}
          aria-describedby={!canApply ? applyReasonId : undefined}
          title={!canApply ? applyStatus : undefined}
          className="inline-flex h-8 items-center justify-center rounded-sm border border-ss-border bg-ss-surface px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface"
        >
          Apply merge
        </button>
      </div>
      <DisabledReason id={applyReasonId} reason={!canApply ? applyStatus : undefined} />
    </section>
  );
}

function mergeReviewStatusText(status: string, conflictCount: number): string {
  if (status === 'conflicted') return `${conflictCount} conflicts`;
  if (status === 'clean') return 'Clean merge';
  if (status === 'fastForward') return 'Ready to apply';
  if (status === 'alreadyMerged') return 'Already merged';
  return 'Blocked';
}

function mergeDiagnosticText(diagnostic: VersionStoreDiagnostic): string | undefined {
  return sanitizeVersionStatusText(
    diagnostic.safeMessage ?? diagnostic.issueCode,
    diagnostic.issueCode,
  );
}

function mergeResolutionOptionLabel(kind: VersionMergeConflictResolutionOptionKind): string {
  if (kind === 'acceptOurs') return 'Ours';
  if (kind === 'acceptTheirs') return 'Source';
  return 'Base';
}

function formatMergeDiffValue(value: VersionDiffValue): string {
  if (value.kind === 'redacted') return 'Redacted';
  const raw = value.value;
  if (raw === null) return 'null';
  if (typeof raw === 'string') return raw.length > 0 ? raw : 'Empty text';
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return 'Structured value';
}
