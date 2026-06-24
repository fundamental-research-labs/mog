import { GitCompare } from 'lucide-react';
import type { VersionSemanticDiffPage, WorkbookCommitId } from '@mog-sdk/contracts/api';

import {
  shortCommitId,
  versionDiffEntryLabel,
  versionDiffPreviewState,
} from './version-history-format';

export type VersionDiffPreview = {
  readonly base: WorkbookCommitId;
  readonly target: WorkbookCommitId;
  readonly page: VersionSemanticDiffPage;
};

export function VersionHistoryDiffPreview({
  diffPreview,
}: {
  readonly diffPreview?: VersionDiffPreview;
}): React.JSX.Element | null {
  if (!diffPreview) return null;
  const count = diffPreview.page.items.length;
  const state = versionDiffPreviewState(diffPreview.page);
  const summaryId = 'version-history-parent-diff-summary';
  const summary = `Parent Diff Base ${shortCommitId(diffPreview.base)} Target ${shortCommitId(
    diffPreview.target,
  )} State ${state.label}. Change count ${count}`;

  return (
    <section
      className="flex flex-col gap-2 border border-ss-border rounded-sm p-2 bg-ss-surface-secondary"
      aria-label="Parent diff"
      aria-describedby={summaryId}
      data-testid="version-history-parent-diff"
      data-state={state.kind}
    >
      <div className="flex items-center gap-2 text-body-sm font-semibold text-ss-text">
        <GitCompare size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Parent Diff</span>
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
      <div className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-1 text-[11px]">
        <span className="text-ss-text-secondary">Base</span>
        <span className="font-mono text-ss-text truncate">{shortCommitId(diffPreview.base)}</span>
        <span className="text-ss-text-secondary">Target</span>
        <span className="font-mono text-ss-text truncate">{shortCommitId(diffPreview.target)}</span>
        <span className="text-ss-text-secondary">Changes</span>
        <span className="text-ss-text">{count}</span>
      </div>
      {state.kind === 'changes' ? (
        <ol className="flex flex-col gap-1 m-0 p-0 list-none">
          {diffPreview.page.items.map((entry, index) => (
            <li key={index} className="text-[11px] text-ss-text-secondary truncate">
              {versionDiffEntryLabel(entry)}
            </li>
          ))}
        </ol>
      ) : (
        <div
          className="rounded-sm border border-ss-warning/40 bg-ss-warning/10 px-2 py-1.5 text-body-sm"
          data-testid="version-history-parent-diff-state"
        >
          <div className="font-medium text-ss-text">{state.title}</div>
          <div className="text-ss-text-secondary">{state.message}</div>
          {state.kind === 'conflict-only' || state.kind === 'redacted' ? (
            <ol className="mt-1 flex flex-col gap-1 m-0 p-0 list-none">
              {diffPreview.page.items.map((entry, index) => (
                <li key={index} className="text-[11px] text-ss-text-secondary truncate">
                  {versionDiffEntryLabel(entry)}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      )}
    </section>
  );
}
