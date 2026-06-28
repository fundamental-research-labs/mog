import { GitCompare } from 'lucide-react';
import type {
  VersionDiffEntry,
  VersionDiffDisplayValue,
  VersionDiffValue,
  VersionSemanticDiffPage,
  VersionSemanticValue,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  formatVersionRowColumnDiffValue,
  semanticObjectFields,
  shortCommitId,
  versionDiffEntryLabel,
  versionDiffPreviewState,
  versionRowColumnDiffSummary,
  versionRowColumnDiffTitle,
} from './version-history-format';

export type VersionDiffPreview = {
  readonly base: WorkbookCommitId;
  readonly target: WorkbookCommitId;
  readonly page: VersionSemanticDiffPage;
};

export function VersionHistoryDiffPreview({
  diffPreview,
  diffEnabled = true,
  diffDisabledReason,
}: {
  readonly diffPreview?: VersionDiffPreview;
  readonly diffEnabled?: boolean;
  readonly diffDisabledReason?: string;
}): React.JSX.Element {
  if (!diffPreview) {
    return (
      <section
        className="flex min-h-[132px] flex-col gap-2 rounded-sm border border-ss-border bg-ss-surface-secondary p-2.5"
        aria-label="Diff viewer"
        data-testid="version-history-diff-viewer"
        data-state={diffEnabled ? 'idle' : 'unavailable'}
      >
        <DiffViewerHeader stateLabel={diffEnabled ? 'No diff' : 'Unavailable'} />
        <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-ss-border bg-ss-surface px-3 py-4 text-[11px] text-ss-text-secondary">
          {diffEnabled ? 'No diff loaded' : 'Diff unavailable'}
        </div>
        {!diffEnabled && diffDisabledReason ? (
          <div
            id="version-diff-unavailable-reason"
            className="text-[11px] leading-snug text-ss-text-secondary"
            data-testid="version-diff-unavailable-reason"
          >
            {diffDisabledReason}
          </div>
        ) : null}
      </section>
    );
  }

  const count = diffPreview.page.items.length;
  const state = versionDiffPreviewState(diffPreview.page);
  const summaryId = 'version-history-parent-diff-summary';
  const summary = `Diff base ${shortCommitId(diffPreview.base)} target ${shortCommitId(
    diffPreview.target,
  )} State ${state.label}. Change count ${count}`;

  return (
    <section
      className="flex min-h-[160px] flex-col gap-2 rounded-sm border border-ss-border bg-ss-surface-secondary p-2.5"
      aria-label="Diff viewer"
      aria-describedby={summaryId}
      data-testid="version-history-diff-viewer"
      data-loaded="true"
      data-state={state.kind}
    >
      <div data-testid="version-history-parent-diff" data-state={state.kind} className="contents">
        <div className="flex items-center justify-between gap-2">
          <DiffViewerHeader stateLabel={state.label} />
          <span className="shrink-0 rounded-sm border border-ss-border bg-ss-surface px-1.5 py-0.5 text-[10px] font-medium text-ss-text-secondary">
            {count} {count === 1 ? 'change' : 'changes'}
          </span>
        </div>
        <p
          id={summaryId}
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="version-history-parent-diff-status"
        >
          {summary}
        </p>
        <CommitRange base={diffPreview.base} target={diffPreview.target} />
        {state.kind === 'changes' ? (
          <ol
            className="m-0 flex max-h-[300px] flex-col gap-1.5 overflow-y-auto p-0 list-none"
            data-testid="version-history-diff-change-list"
          >
            {diffPreview.page.items.map((entry, index) => (
              <DiffChangeRow key={index} entry={entry} />
            ))}
          </ol>
        ) : (
          <div
            className="rounded-sm border border-ss-warning/40 bg-ss-warning/10 px-2.5 py-2 text-[11px]"
            data-testid="version-history-parent-diff-state"
          >
            <div className="font-medium text-ss-text">{state.title}</div>
            <div className="text-ss-text-secondary">{state.message}</div>
            {state.kind === 'conflict-only' || state.kind === 'redacted' ? (
              <ol className="m-0 mt-2 flex flex-col gap-1 p-0 list-none">
                {diffPreview.page.items.map((entry, index) => (
                  <li key={index} className="text-[11px] text-ss-text-secondary truncate">
                    {versionDiffEntryLabel(entry)}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function DiffViewerHeader({ stateLabel }: { readonly stateLabel: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-ss-text">
      <GitCompare size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{stateLabel}</span>
    </div>
  );
}

function CommitRange({
  base,
  target,
}: {
  readonly base: WorkbookCommitId;
  readonly target: WorkbookCommitId;
}): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-sm border border-ss-border bg-ss-surface px-2 py-0.5 text-[10px] text-ss-text-secondary">
      <span className="sr-only">
        Base {shortCommitId(base)} target {shortCommitId(target)}
      </span>
      <div className="truncate font-mono" aria-hidden="true">
        {shortCommitId(base)}...{shortCommitId(target)}
      </div>
    </div>
  );
}

function DiffChangeRow({ entry }: { readonly entry: VersionDiffEntry }): React.JSX.Element {
  return (
    <li className="overflow-hidden rounded-sm border border-ss-border bg-ss-surface">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-ss-border-light bg-ss-surface-secondary px-2 py-1">
        <div className="min-w-0 truncate text-[11px] font-medium text-ss-text">
          {diffEntryTitle(entry)}
        </div>
        {entry.diagnostics?.length ? (
          <span className="shrink-0 rounded-sm border border-ss-warning/40 bg-ss-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ss-text-secondary">
            Diagnostic
          </span>
        ) : null}
      </div>
      <div className="font-mono text-[10px] leading-4">
        <DiffLine label="Before" marker="-" tone="removed" side="before" entry={entry} />
        <DiffLine label="After" marker="+" tone="added" side="after" entry={entry} />
      </div>
    </li>
  );
}

function DiffLine({
  label,
  marker,
  tone,
  side,
  entry,
}: {
  readonly label: string;
  readonly marker: '-' | '+';
  readonly tone: 'removed' | 'added';
  readonly side: 'before' | 'after';
  readonly entry: VersionDiffEntry;
}): React.JSX.Element {
  const formattedValue = formatDiffValue(entry, side);
  const toneClass =
    tone === 'removed'
      ? 'border-l-ss-error bg-ss-error-bg text-ss-error-text'
      : 'border-l-ss-success bg-ss-success-bg text-ss-success-text';

  return (
    <div
      className={`grid grid-cols-[1.25rem_minmax(0,1fr)] border-l-2 ${toneClass}`}
      aria-label={`${label}: ${formattedValue}`}
    >
      <span
        className="select-none border-r border-current/15 text-center font-semibold"
        aria-hidden="true"
      >
        {marker}
      </span>
      <span className="min-w-0 break-words px-1.5 py-0.5">
        <span className="sr-only">{label}: </span>
        {formattedValue}
      </span>
    </div>
  );
}

function diffEntryTitle(entry: VersionDiffEntry): string {
  const rowColumnSummary = versionRowColumnDiffSummary(entry);
  if (rowColumnSummary) return versionRowColumnDiffTitle(rowColumnSummary);

  const address = formatDisplayValue(entry.display?.address);
  const entityLabel = formatDisplayValue(entry.display?.entityLabel);
  if (address && entityLabel) return `${entityLabel} ${address}`;
  if (address) return address;
  if (entityLabel) return entityLabel;
  if (entry.structural.kind === 'metadata') return entry.structural.entityId;
  return 'Restricted change';
}

function formatDisplayValue(value: VersionDiffDisplayValue | undefined): string | undefined {
  if (!value || value.kind === 'redacted') return undefined;
  return value.value.trim().length > 0 ? value.value : undefined;
}

function formatDiffValue(entry: VersionDiffEntry, side: 'before' | 'after'): string {
  const value = side === 'before' ? entry.before : entry.after;
  if (value.kind === 'redacted') return 'Redacted';
  const rowColumnSummary = versionRowColumnDiffSummary(entry);
  if (rowColumnSummary) {
    const rowColumnValue = formatVersionRowColumnDiffValue(rowColumnSummary, value, side);
    if (rowColumnValue) return rowColumnValue;
  }
  return truncateValue(formatSemanticValue(value.value), 96);
}

function formatSemanticValue(value: VersionSemanticValue, depth = 0): string {
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
  return formatSemanticObjectValue(value, depth);
}

function formatSemanticObjectValue(value: VersionSemanticValue, depth: number): string {
  const fields = semanticObjectFields(value);
  if (!fields) return 'Object';
  if (fields.length === 0) return 'Object';
  if (depth >= 2) return `Object (${fields.length})`;
  return fields
    .map((field) => `${field.key}: ${formatSemanticValue(field.value, depth + 1)}`)
    .join(', ');
}

function truncateValue(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
