import { GitCompare } from 'lucide-react';
import type {
  VersionDiffDisplay,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionMergeResult,
  VersionRef,
  VersionSemanticValue,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  DisabledReason,
  safeDomId,
  sanitizeVersionStatusText,
} from '../availability/version-action-availability';
import { displayBranchName } from '../version-branch-name';
import { shortCommitId } from '../version-history-format';
import type { VersionMergePreviewState, VersionMergeResolutionSelections } from './merge-actions';

export type VersionMergeControlsProps = {
  readonly sourceRefs: readonly VersionRef[];
  readonly selectedSourceRefName: string;
  readonly currentHeadId?: WorkbookCommitId;
  readonly currentRefName?: string;
  readonly previewState: VersionMergePreviewState;
  readonly resolutionSelections: VersionMergeResolutionSelections;
  readonly previewEnabled: boolean;
  readonly applyEnabled: boolean;
  readonly previewDisabledReason?: string;
  readonly applyDisabledReason?: string;
  readonly onSourceRefNameChange: (refName: string) => void;
  readonly onPreviewMerge: () => void;
  readonly onApplyMerge: () => void;
  readonly onResolutionChange: (conflictId: string, optionId: string) => void;
};

export function VersionMergeControls({
  sourceRefs,
  selectedSourceRefName,
  currentHeadId,
  currentRefName,
  previewState,
  resolutionSelections,
  previewEnabled,
  applyEnabled,
  previewDisabledReason,
  applyDisabledReason,
  onSourceRefNameChange,
  onPreviewMerge,
  onApplyMerge,
  onResolutionChange,
}: VersionMergeControlsProps): React.JSX.Element {
  const previewReasonId = 'version-merge-preview-disabled-reason';
  const applyReasonId = 'version-merge-apply-disabled-reason';
  const previewReason = sanitizeVersionStatusText(
    previewDisabledReason,
    'Merge preview is unavailable.',
  );
  const applyReason = sanitizeVersionStatusText(applyDisabledReason, 'Merge apply is unavailable.');
  const selectedSource = sourceRefs.find((ref) => ref.name === selectedSourceRefName);
  const selectClassName = [
    'h-8 w-full rounded-sm border border-ss-border bg-ss-surface px-2',
    'text-body-sm text-ss-text outline-none focus:border-ss-primary disabled:opacity-50',
  ].join(' ');
  const buttonClassName = [
    'inline-flex h-7 items-center justify-center rounded-sm border border-ss-border',
    'bg-ss-surface-secondary px-2 text-[11px] font-medium text-ss-text transition-colors',
    'hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary',
  ].join(' ');

  return (
    <section
      className="flex flex-col gap-2 rounded-sm border border-ss-border bg-ss-surface p-2.5"
      aria-label="Merge"
      data-testid="version-history-merge-controls"
    >
      <div className="flex items-center gap-2 text-body-sm font-semibold text-ss-text">
        <GitCompare size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Merge</span>
      </div>

      <div className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-1 text-[11px]">
        <span className="text-ss-text-secondary">Into</span>
        <span className="min-w-0 text-ss-text truncate" data-testid="version-merge-target-ref">
          {currentRefName ? displayBranchName(currentRefName) : 'Current head'}
        </span>
        <span className="text-ss-text-secondary">Head</span>
        <span className="font-mono text-ss-text truncate" data-testid="version-merge-target-head">
          {currentHeadId ? shortCommitId(currentHeadId) : 'Unavailable'}
        </span>
      </div>

      <label htmlFor="version-merge-source" className="text-[11px] text-ss-text-secondary">
        Source branch/ref
      </label>
      <select
        id="version-merge-source"
        data-testid="version-merge-source-ref-select"
        value={selectedSourceRefName}
        onChange={(event) => onSourceRefNameChange(event.currentTarget.value)}
        disabled={sourceRefs.length === 0}
        className={selectClassName}
      >
        {sourceRefs.length === 0 ? (
          <option value="">No source refs available</option>
        ) : (
          sourceRefs.map((ref) => (
            <option key={ref.name} value={ref.name}>
              {displayBranchName(ref.name)} - {shortCommitId(ref.commitId)}
            </option>
          ))
        )}
      </select>

      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 font-mono text-[11px] text-ss-text-secondary truncate">
          Source {selectedSource ? shortCommitId(selectedSource.commitId) : 'unavailable'}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            data-testid="version-merge-preview-button"
            data-capability="version:mergePreview"
            onClick={onPreviewMerge}
            disabled={!previewEnabled}
            aria-describedby={!previewEnabled && previewReason ? previewReasonId : undefined}
            title={!previewEnabled ? previewReason : undefined}
            className={buttonClassName}
          >
            Preview
          </button>
          <button
            type="button"
            data-testid="version-merge-apply-button"
            data-capability="version:mergeApply"
            onClick={onApplyMerge}
            disabled={!applyEnabled}
            aria-describedby={!applyEnabled && applyReason ? applyReasonId : undefined}
            title={!applyEnabled ? applyReason : undefined}
            className={buttonClassName}
          >
            Apply
          </button>
        </div>
      </div>
      <DisabledReason id={previewReasonId} reason={!previewEnabled ? previewReason : undefined} />
      <DisabledReason id={applyReasonId} reason={!applyEnabled ? applyReason : undefined} />

      <MergePreviewSummary
        previewState={previewState}
        resolutionSelections={resolutionSelections}
        onResolutionChange={onResolutionChange}
      />
    </section>
  );
}

function MergePreviewSummary({
  previewState,
  resolutionSelections,
  onResolutionChange,
}: {
  readonly previewState: VersionMergePreviewState;
  readonly resolutionSelections: VersionMergeResolutionSelections;
  readonly onResolutionChange: (conflictId: string, optionId: string) => void;
}): React.JSX.Element | null {
  if (previewState.kind === 'idle') return null;

  if (previewState.kind === 'blocked') {
    return (
      <div
        className="rounded-sm border border-ss-warning/40 bg-ss-warning/10 px-2 py-1.5 text-body-sm"
        data-testid="version-merge-preview-status"
        data-status="blocked"
      >
        <div className="font-medium text-ss-text">Blocked</div>
        <div className="text-ss-text-secondary">{previewState.message}</div>
      </div>
    );
  }

  const result = previewState.result;
  const status = mergeStatusCopy(result);
  const summaryId = 'version-merge-preview-summary';
  const summary = `Merge preview ${status.label}. Base ${shortCommitId(
    previewState.input.base,
  )}. Ours ${shortCommitId(previewState.input.ours)}. Theirs ${shortCommitId(
    previewState.input.theirs,
  )}. Changes ${result.changes.length}. Conflicts ${result.conflicts.length}.`;

  return (
    <div
      className={`rounded-sm border px-2 py-1.5 text-body-sm ${status.className}`}
      data-testid="version-merge-preview-status"
      data-status={result.status}
      aria-describedby={summaryId}
    >
      <p id={summaryId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {summary}
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ss-text">{status.label}</span>
        <span className="text-[11px] uppercase text-ss-text-tertiary">
          {result.conflicts.length > 0
            ? `${result.conflicts.length} conflicts`
            : `${result.changes.length} changes`}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-[52px_1fr] gap-x-2 gap-y-1 text-[11px]">
        <span className="text-ss-text-secondary">Base</span>
        <span className="font-mono text-ss-text truncate">
          {shortCommitId(previewState.input.base)}
        </span>
        <span className="text-ss-text-secondary">Ours</span>
        <span className="font-mono text-ss-text truncate">
          {shortCommitId(previewState.input.ours)}
        </span>
        <span className="text-ss-text-secondary">Theirs</span>
        <span className="font-mono text-ss-text truncate">
          {shortCommitId(previewState.input.theirs)}
        </span>
      </div>
      {result.status === 'blocked' ? <MergeDiagnostics result={result} /> : null}
      {result.status === 'conflicted' ? (
        <MergeConflictResolutions
          conflicts={result.conflicts}
          selections={resolutionSelections}
          onResolutionChange={onResolutionChange}
        />
      ) : null}
    </div>
  );
}

function MergeConflictResolutions({
  conflicts,
  selections,
  onResolutionChange,
}: {
  readonly conflicts: readonly VersionMergeConflict[];
  readonly selections: VersionMergeResolutionSelections;
  readonly onResolutionChange: (conflictId: string, optionId: string) => void;
}): React.JSX.Element {
  const conflictListLabel =
    conflicts.length === 1
      ? '1 merge conflict requiring resolution'
      : `${conflicts.length} merge conflicts requiring resolution`;

  return (
    <div
      role="region"
      aria-label={conflictListLabel}
      data-testid="version-merge-conflict-list"
      className="mt-2 flex max-h-52 flex-col gap-2 overflow-y-auto pr-1"
    >
      {conflicts.map((conflict, index) => {
        const label = conflictLabel(conflict, index);
        return (
          <fieldset
            key={conflict.conflictId}
            data-testid={`version-merge-conflict-${safeDomId(conflict.conflictId)}`}
            className="m-0 rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5"
          >
            <legend className="px-1 text-[11px] font-medium text-ss-text">{label}</legend>
            <div className="flex flex-col gap-1">
              {conflict.resolutionOptions.length === 0 ? (
                <p className="m-0 text-[11px] text-ss-warning">
                  {conflictResolutionUnavailableMessage(conflict)}
                </p>
              ) : (
                conflict.resolutionOptions.map((option) => (
                  <MergeConflictResolutionOptionRow
                    key={option.optionId}
                    option={option}
                    conflictLabel={label}
                    checked={selections[conflict.conflictId] === option.optionId}
                    onChange={() => onResolutionChange(conflict.conflictId, option.optionId)}
                  />
                ))
              )}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function MergeConflictResolutionOptionRow({
  option,
  conflictLabel,
  checked,
  onChange,
}: {
  readonly option: VersionMergeConflictResolutionOption;
  readonly conflictLabel: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}): React.JSX.Element {
  const id = `version-merge-resolution-${safeDomId(option.conflictId)}-${safeDomId(
    option.optionId,
  )}`;
  const label = resolutionOptionLabel(option.kind);
  const formattedValue = formatDiffValue(option.value);

  return (
    <label htmlFor={id} className="flex items-start gap-2 text-[11px] text-ss-text-secondary">
      <input
        id={id}
        type="radio"
        name={`version-merge-resolution-${safeDomId(option.conflictId)}`}
        aria-label={`${conflictLabel}: ${label} - ${formattedValue}`}
        data-testid={`version-merge-resolution-option-${safeDomId(option.conflictId)}-${safeDomId(
          option.optionId,
        )}`}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-ss-primary"
      />
      <span className="min-w-0">
        <span className="font-medium text-ss-text">{label}</span>
        <span className="mx-1 text-ss-text-tertiary">-</span>
        <span className="break-words">{formattedValue}</span>
      </span>
    </label>
  );
}

function MergeDiagnostics({ result }: { readonly result: VersionMergeResult }): React.JSX.Element {
  return (
    <ol className="mt-2 flex flex-col gap-1 m-0 p-0 list-none">
      {result.diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic.issueCode}-${index}`} className="text-[11px] text-ss-text-secondary">
          {sanitizeVersionStatusText(diagnostic.safeMessage, 'Merge preview was blocked.') ??
            'Merge preview was blocked.'}
        </li>
      ))}
    </ol>
  );
}

function mergeStatusCopy(result: VersionMergeResult): {
  readonly label: string;
  readonly className: string;
} {
  if (result.status === 'clean') {
    return {
      label: 'Clean',
      className: 'border-ss-success/40 bg-ss-success/10',
    };
  }
  if (result.status === 'conflicted') {
    return {
      label: 'Conflicted',
      className: 'border-ss-warning/40 bg-ss-warning/10',
    };
  }
  if (result.status === 'fastForward') {
    return {
      label: 'Fast-forward',
      className: 'border-ss-success/40 bg-ss-success/10',
    };
  }
  if (result.status === 'alreadyMerged') {
    return {
      label: 'Already merged',
      className: 'border-ss-border bg-ss-surface-secondary',
    };
  }
  return {
    label: 'Blocked',
    className: 'border-ss-warning/40 bg-ss-warning/10',
  };
}

function conflictLabel(conflict: VersionMergeConflict, index: number): string {
  const displayLabel = displayValue(conflict.display);
  if (displayLabel) return displayLabel;
  if (conflict.structural.kind !== 'metadata') return `Conflict ${index + 1}`;
  const path = conflict.structural.propertyPath.join('.');
  return path
    ? `${conflict.structural.domain} ${path}`
    : `${conflict.structural.domain} ${index + 1}`;
}

function displayValue(display: VersionDiffDisplay | undefined): string | undefined {
  const candidates = [display?.address, display?.entityLabel, display?.sheetName];
  for (const candidate of candidates) {
    if (candidate?.kind === 'value' && candidate.value.trim().length > 0) return candidate.value;
  }
  return undefined;
}

function resolutionOptionLabel(kind: VersionMergeConflictResolutionOption['kind']): string {
  if (kind === 'acceptOurs') return 'Ours';
  if (kind === 'acceptTheirs') return 'Source';
  return 'Base';
}

function conflictResolutionUnavailableMessage(conflict: VersionMergeConflict): string {
  const diagnosticMessage = conflict.diagnostics?.find(
    (diagnostic) => diagnostic.safeMessage.trim().length > 0,
  )?.safeMessage;
  return (
    sanitizeVersionStatusText(
      diagnosticMessage,
      'No selectable resolution is available for this conflict.',
    ) ?? 'No selectable resolution is available for this conflict.'
  );
}

function formatDiffValue(value: VersionDiffValue): string {
  if (value.kind === 'redacted') return 'Redacted';
  return truncateValue(formatSemanticValue(value.value), 80);
}

function formatSemanticValue(value: VersionSemanticValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length === 0 ? 'Empty text' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value.kind === 'blank') return 'Blank';
  if (value.kind === 'dateTime') return value.iso;
  if (value.kind === 'duration') return value.iso;
  if (value.kind === 'error') return value.message ? `${value.code}: ${value.message}` : value.code;
  if (value.kind === 'formula') return value.formula;
  if (value.kind === 'richText') return value.runs.map((run) => run.text).join('');
  if (value.kind === 'array') return `Array (${value.values.length})`;
  return `Object (${value.fields.length})`;
}

function truncateValue(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
