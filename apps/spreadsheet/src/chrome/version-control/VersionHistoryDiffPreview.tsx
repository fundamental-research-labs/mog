import { Filter, GitCompare } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  VersionDiffEntry,
  VersionDiffDisplayValue,
  VersionDiffFilters,
  VersionDiffGroup,
  VersionDiffGroupId,
  VersionDiffOverview,
  VersionDiffOperation,
  VersionDiffValue,
  VersionSemanticDiffPage,
  VersionSemanticValue,
  VersionWorkingTreeDiffPage,
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
import { safeDomId } from './availability/version-action-availability';

export type VersionDiffPreview = {
  readonly base: WorkbookCommitId;
  readonly target: WorkbookCommitId;
  readonly overview: VersionDiffOverview;
  readonly activeGroupId?: VersionDiffGroupId;
  readonly detailPages: readonly VersionSemanticDiffPage[];
  readonly detailItems: readonly VersionDiffEntry[];
  readonly detailNextCursor?: VersionSemanticDiffPage['nextCursor'];
  readonly loadedDetailCount: number;
  readonly loadedDetailPageCount: number;
  readonly hasMoreDetail: boolean;
  readonly loadingGroups: boolean;
  readonly loadingDetail: boolean;
  readonly filters?: VersionDiffFilterSelection;
};

export type VersionDiffFilterOperation = Exclude<VersionDiffOperation, 'mixed'>;

export type VersionDiffFilterSelection = {
  readonly sheetId?: string;
  readonly domain?: string;
  readonly operation?: VersionDiffFilterOperation;
};

export function VersionHistoryDiffPreview({
  diffPreview,
  diffEnabled = true,
  diffDisabledReason,
  onLoadMoreGroups,
  onSelectGroup,
  onLoadMoreDetail,
  onFiltersChange,
}: {
  readonly diffPreview?: VersionDiffPreview;
  readonly diffEnabled?: boolean;
  readonly diffDisabledReason?: string;
  readonly onLoadMoreGroups: () => void;
  readonly onSelectGroup: (groupId: VersionDiffGroupId) => void;
  readonly onLoadMoreDetail: () => void;
  readonly onFiltersChange?: (filters: VersionDiffFilterSelection) => void;
}): React.JSX.Element {
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  const summary = diffPreview.overview.summary;
  const state = summary.exactTotalChanges === 0 ? 'empty' : summary.incomplete ? 'incomplete' : 'changes';
  const summaryId = 'version-history-parent-diff-summary';
  const summaryText = `Diff base ${shortCommitId(diffPreview.base)} target ${shortCommitId(
    diffPreview.target,
  )}. ${formatSummaryCount(summary)}. Loaded detail ${diffPreview.loadedDetailCount}`;

  return (
    <section
      className="flex min-h-[160px] flex-col gap-2 rounded-sm border border-ss-border bg-ss-surface-secondary p-2.5"
      aria-label="Diff viewer"
      aria-describedby={summaryId}
      data-testid="version-history-diff-viewer"
      data-loaded="true"
      data-state={state}
    >
      <div data-testid="version-history-parent-diff" data-state={state} className="contents">
        <div className="flex items-center justify-between gap-2">
          <DiffViewerHeader stateLabel="Changes" />
          <div className="flex shrink-0 items-center gap-1.5">
            <DiffFilterMenu
              preview={diffPreview}
              open={filtersOpen}
              onOpenChange={setFiltersOpen}
              onFiltersChange={onFiltersChange}
            />
            <span
              className="rounded-sm border border-ss-border bg-ss-surface px-1.5 py-0.5 text-[10px] font-medium text-ss-text-secondary"
              data-testid="version-history-diff-total-count"
              data-count-precision={summary.countPrecision}
            >
              {formatSummaryCount(summary)}
            </span>
          </div>
        </div>
        <p
          id={summaryId}
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="version-history-parent-diff-status"
        >
          {summaryText}
        </p>
        <CommitRange base={diffPreview.base} target={diffPreview.target} />
        <DiffOverview preview={diffPreview} />
        <DiffGroupList
          preview={diffPreview}
          onLoadMoreGroups={onLoadMoreGroups}
          onSelectGroup={onSelectGroup}
        />
        <DiffDetail preview={diffPreview} onLoadMoreDetail={onLoadMoreDetail} />
      </div>
    </section>
  );
}

function DiffFilterMenu({
  preview,
  open,
  onOpenChange,
  onFiltersChange,
}: {
  readonly preview: VersionDiffPreview;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onFiltersChange?: (filters: VersionDiffFilterSelection) => void;
}): React.JSX.Element {
  const activeCount = activeFilterCount(preview.filters);
  const disabled = !onFiltersChange || (!hasFilterOptions(preview) && activeCount === 0);
  const label = activeCount > 0 ? `Filters, ${activeCount} active` : 'Filters';

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="version-history-diff-filter-button"
        aria-label={label}
        aria-expanded={open && !disabled}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        className="inline-flex h-6 items-center justify-center gap-1 rounded-sm border border-ss-border bg-ss-surface px-1.5 text-[10px] font-medium text-ss-text-secondary transition-colors hover:bg-ss-surface-hover hover:text-ss-text disabled:opacity-50 disabled:hover:bg-ss-surface"
      >
        <Filter size={12} strokeWidth={1.75} aria-hidden="true" />
        <span>Filter</span>
        {activeCount > 0 ? (
          <span
            className="ml-0.5 rounded-sm bg-ss-primary px-1 text-[9px] leading-4 text-white"
            aria-hidden="true"
          >
            {activeCount}
          </span>
        ) : null}
      </button>
      {open && !disabled ? (
        <div
          role="dialog"
          aria-label="Diff filters"
          data-testid="version-history-diff-filter-menu"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onOpenChange(false);
          }}
          className="absolute right-0 top-full z-ss-popover mt-1 w-[284px] rounded-sm border border-ss-border bg-ss-surface p-2 shadow-ss-dropdown"
        >
          <DiffFilterControls
            preview={preview}
            onFiltersChange={onFiltersChange}
            layout="menu"
          />
        </div>
      ) : null}
    </div>
  );
}

function activeFilterCount(filters: VersionDiffFilterSelection | undefined): number {
  if (!filters) return 0;
  return (
    Number(Boolean(filters.sheetId)) +
    Number(Boolean(filters.domain)) +
    Number(Boolean(filters.operation))
  );
}

function hasFilterOptions(preview: VersionDiffPreview): boolean {
  const options = diffFilterOptions(preview);
  return options.sheets.length > 0 || options.domains.length > 0 || options.operations.length > 0;
}

export function versionDiffFiltersFromSelection(
  selection: VersionDiffFilterSelection,
): VersionDiffFilters | undefined {
  const filters: VersionDiffFilters = {
    ...(selection.sheetId ? { sheetIds: [selection.sheetId] } : {}),
    ...(selection.domain ? { domains: [selection.domain] } : {}),
    ...(selection.operation ? { operations: [selection.operation] } : {}),
  };
  return Object.keys(filters).length === 0 ? undefined : filters;
}

export function VersionHistoryWorkingTreeDiffPreview({
  page,
}: {
  readonly page: VersionWorkingTreeDiffPage;
}): React.JSX.Element {
  const count = page.items.length;
  const state = versionDiffPreviewState(page);
  const summaryId = 'version-history-working-tree-diff-summary';
  const summary = `Uncommitted changes. Working tree diff base ${shortCommitId(page.baseCommitId)} State ${
    state.label
  }. Change count ${count}`;

  return (
    <section
      className="flex min-h-[160px] flex-col gap-2 rounded-sm border border-ss-border bg-ss-surface-secondary p-2.5"
      aria-label="Working tree diff viewer"
      aria-describedby={summaryId}
      data-testid="version-history-working-tree-diff-viewer"
      data-loaded="true"
      data-state={state.kind}
    >
      <div data-testid="version-history-working-tree-diff" data-state={state.kind} className="contents">
        <div className="flex items-center justify-between gap-2">
          <DiffViewerHeader stateLabel="Uncommitted changes" />
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
          data-testid="version-history-working-tree-diff-status"
        >
          {summary}
        </p>
        <WorkingTreeRange page={page} />
        {state.kind === 'changes' ? (
          <div
            className="m-0 flex max-h-[300px] flex-col gap-1.5 overflow-y-auto p-0 list-none"
            data-testid="version-history-working-tree-diff-change-list"
          >
            {page.items.map((entry, index) => (
              <DiffChangeRow key={index} entry={entry} />
            ))}
          </div>
        ) : (
          <div
            className="rounded-sm border border-ss-warning/40 bg-ss-warning/10 px-2.5 py-2 text-[11px]"
            data-testid="version-history-working-tree-diff-state"
          >
            <div className="font-medium text-ss-text">{state.title}</div>
            <div className="text-ss-text-secondary">{state.message}</div>
            {state.kind === 'conflict-only' || state.kind === 'redacted' ? (
              <ol className="m-0 mt-2 flex flex-col gap-1 p-0 list-none">
                {page.items.map((entry, index) => (
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

function DiffOverview({ preview }: { readonly preview: VersionDiffPreview }): React.JSX.Element {
  const { summary, resourceLimits } = preview.overview;
  return (
    <div
      className="grid gap-1.5 rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-[11px]"
      data-testid="version-history-diff-overview"
      data-count-precision={summary.countPrecision}
      data-exact-total={summary.exactTotalChanges ?? ''}
      data-minimum-count={summary.minimumChangeCount ?? ''}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ss-text">{formatSummaryCount(summary)}</span>
        <span
          className="text-ss-text-secondary"
          data-testid="version-history-diff-loaded-count"
        >
          {preview.loadedDetailCount} loaded
        </span>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-ss-text-secondary">
        <span>{preview.overview.groups.items.length} groups</span>
        <span>{preview.loadedDetailPageCount} detail pages cached</span>
        {preview.hasMoreDetail ? <span>More detail available</span> : null}
        {summary.incomplete ? <span className="font-medium text-ss-warning">Incomplete</span> : null}
      </div>
      {summary.domainCounts.length > 0 ? (
        <div className="flex flex-wrap gap-1" data-testid="version-history-diff-domain-counts">
          {summary.domainCounts.slice(0, 6).map((count) => (
            <span
              key={count.domain}
              className="rounded-sm border border-ss-border bg-ss-surface-secondary px-1.5 py-0.5"
            >
              {count.domain}: {count.exactCount ?? count.minimumCount ?? count.totalEstimate ?? '?'}
            </span>
          ))}
        </div>
      ) : null}
      {resourceLimits?.exactTotalCountUnavailable ? (
        <div className="text-ss-text-secondary" data-testid="version-history-diff-resource-limits">
          Exact total unavailable within scan budget
        </div>
      ) : null}
    </div>
  );
}

function DiffFilterControls({
  preview,
  onFiltersChange,
  layout = 'inline',
}: {
  readonly preview: VersionDiffPreview;
  readonly onFiltersChange?: (filters: VersionDiffFilterSelection) => void;
  readonly layout?: 'inline' | 'menu';
}): React.JSX.Element {
  const options = diffFilterOptions(preview);
  const filters = preview.filters ?? {};
  const addressReason = unsupportedFilterReason(preview.overview, 'address');
  const searchReason = unsupportedFilterReason(preview.overview, 'search');
  const controlsDisabled = !onFiltersChange || preview.loadingGroups || preview.loadingDetail;

  const update = (patch: VersionDiffFilterSelection) => {
    if (!onFiltersChange) return;
    onFiltersChange(cleanFilterSelection({ ...filters, ...patch }));
  };

  return (
    <div
      className={
        layout === 'menu'
          ? 'grid grid-cols-1 gap-2 text-[11px]'
          : 'grid grid-cols-3 gap-1.5 rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-[11px]'
      }
      data-testid="version-history-diff-filters"
    >
      <label className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[10px] font-medium text-ss-text-secondary">Sheet</span>
        <select
          data-testid="version-history-diff-filter-sheet"
          value={filters.sheetId ?? ''}
          onChange={(event) => update({ sheetId: event.currentTarget.value || undefined })}
          disabled={controlsDisabled || options.sheets.length === 0}
          className="h-7 min-w-0 rounded-sm border border-ss-border bg-ss-surface-secondary px-1.5 text-[11px] text-ss-text disabled:opacity-50"
        >
          <option value="">All sheets</option>
          {options.sheets.map((sheet) => (
            <option key={sheet.value} value={sheet.value}>
              {sheet.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[10px] font-medium text-ss-text-secondary">Domain</span>
        <select
          data-testid="version-history-diff-filter-domain"
          value={filters.domain ?? ''}
          onChange={(event) => update({ domain: event.currentTarget.value || undefined })}
          disabled={controlsDisabled || options.domains.length === 0}
          className="h-7 min-w-0 rounded-sm border border-ss-border bg-ss-surface-secondary px-1.5 text-[11px] text-ss-text disabled:opacity-50"
        >
          <option value="">All domains</option>
          {options.domains.map((domain) => (
            <option key={domain} value={domain}>
              {domain}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[10px] font-medium text-ss-text-secondary">Operation</span>
        <select
          data-testid="version-history-diff-filter-operation"
          value={filters.operation ?? ''}
          onChange={(event) =>
            update({
              operation: (event.currentTarget.value || undefined) as VersionDiffFilterOperation,
            })
          }
          disabled={controlsDisabled || options.operations.length === 0}
          className="h-7 min-w-0 rounded-sm border border-ss-border bg-ss-surface-secondary px-1.5 text-[11px] text-ss-text disabled:opacity-50"
        >
          <option value="">All operations</option>
          {options.operations.map((operation) => (
            <option key={operation} value={operation}>
              {operation}
            </option>
          ))}
        </select>
      </label>
      <DisabledFilterControl
        label="Address"
        testId="version-history-diff-filter-address"
        reason={addressReason}
        layout={layout}
      />
      <DisabledFilterControl
        label="Search"
        testId="version-history-diff-filter-search"
        reason={searchReason}
        layout={layout}
      />
    </div>
  );
}

function DisabledFilterControl({
  label,
  testId,
  reason,
  layout = 'inline',
}: {
  readonly label: string;
  readonly testId: string;
  readonly reason: string;
  readonly layout?: 'inline' | 'menu';
}): React.JSX.Element {
  const reasonId = `${testId}-reason`;
  return (
    <label
      className={
        layout === 'menu'
          ? 'flex min-w-0 flex-col gap-0.5'
          : 'col-span-3 flex min-w-0 flex-col gap-0.5 sm:col-span-1'
      }
    >
      <span className="text-[10px] font-medium text-ss-text-secondary">{label}</span>
      <input
        data-testid={testId}
        aria-describedby={reasonId}
        value=""
        readOnly
        disabled
        placeholder="Unavailable"
        className="h-7 min-w-0 rounded-sm border border-ss-border bg-ss-surface-secondary px-1.5 text-[11px] text-ss-text disabled:opacity-50"
      />
      <span id={reasonId} className="truncate text-[10px] text-ss-text-secondary">
        {reason}
      </span>
    </label>
  );
}

function diffFilterOptions(preview: VersionDiffPreview): {
  readonly sheets: readonly { readonly value: string; readonly label: string }[];
  readonly domains: readonly string[];
  readonly operations: readonly VersionDiffFilterOperation[];
} {
  const sheets = new Map<string, string>();
  const domains = new Set<string>();
  const operations = new Set<VersionDiffFilterOperation>();

  for (const group of preview.overview.groups.items) {
    if (group.sheetId) {
      sheets.set(group.sheetId, formatDisplayValue(group.sheetName) ?? group.sheetId);
    }
    domains.add(group.domain);
    if (group.operation !== 'mixed') operations.add(group.operation);
  }
  for (const count of preview.overview.summary.domainCounts) {
    domains.add(count.domain);
  }
  for (const count of preview.overview.summary.operationCounts) {
    operations.add(count.operation);
  }

  const filters = preview.filters ?? {};
  if (filters.sheetId && !sheets.has(filters.sheetId)) {
    sheets.set(filters.sheetId, filters.sheetId);
  }
  if (filters.domain) domains.add(filters.domain);
  if (filters.operation) operations.add(filters.operation);

  return {
    sheets: [...sheets.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label) || left.value.localeCompare(right.value),
      ),
    domains: [...domains].sort(),
    operations: [...operations].sort(),
  };
}

function unsupportedFilterReason(
  overview: VersionDiffOverview,
  filter: 'address' | 'search',
): string {
  return (
    overview.unsupportedFilters.find((item) => item.filter === filter)?.reason ??
    (filter === 'address'
      ? 'Address filters require a historical range index.'
      : 'Formula and text search requires a redaction-aware search index.')
  );
}

function cleanFilterSelection(selection: VersionDiffFilterSelection): VersionDiffFilterSelection {
  return {
    ...(selection.sheetId ? { sheetId: selection.sheetId } : {}),
    ...(selection.domain ? { domain: selection.domain } : {}),
    ...(selection.operation ? { operation: selection.operation } : {}),
  };
}

function DiffGroupList({
  preview,
  onLoadMoreGroups,
  onSelectGroup,
}: {
  readonly preview: VersionDiffPreview;
  readonly onLoadMoreGroups: () => void;
  readonly onSelectGroup: (groupId: VersionDiffGroupId) => void;
}): React.JSX.Element {
  const groups = preview.overview.groups.items;
  if (groups.length === 0) {
    return (
      <div
        className="rounded-sm border border-dashed border-ss-border bg-ss-surface px-2 py-3 text-center text-[11px] text-ss-text-secondary"
        data-testid="version-history-diff-empty-groups"
      >
        No grouped changes
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <ol
        className="m-0 flex max-h-[220px] flex-col gap-1 overflow-y-auto p-0 list-none"
        data-testid="version-history-diff-group-list"
      >
        {groups.map((group) => (
          <li key={group.groupId}>
            <button
              type="button"
              data-testid={`version-history-diff-group-row-${safeDomId(group.groupId)}`}
              data-group-kind={group.kind}
              data-change-count={group.changeCount ?? group.minimumChangeCount ?? ''}
              aria-pressed={preview.activeGroupId === group.groupId}
              onClick={() => onSelectGroup(group.groupId)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-ss-surface-hover aria-pressed:border-ss-primary aria-pressed:bg-ss-primary/10"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-ss-text">
                  {formatGroupTitle(group)}
                </span>
                <span className="block truncate text-ss-text-secondary">
                  {group.domain} - {group.operation} - historical metadata
                </span>
              </span>
              <span className="shrink-0 text-ss-text-secondary">
                {formatGroupCount(group)}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {preview.overview.groups.nextCursor ? (
        <button
          type="button"
          data-testid="version-history-diff-load-more-groups"
          onClick={onLoadMoreGroups}
          disabled={preview.loadingGroups}
          className="h-8 rounded-sm border border-ss-border bg-ss-surface px-2 text-[11px] font-medium text-ss-text hover:bg-ss-surface-hover disabled:opacity-50"
        >
          {preview.loadingGroups ? 'Loading groups' : 'Load more groups'}
        </button>
      ) : null}
    </div>
  );
}

function DiffDetail({
  preview,
  onLoadMoreDetail,
}: {
  readonly preview: VersionDiffPreview;
  readonly onLoadMoreDetail: () => void;
}): React.JSX.Element | null {
  if (!preview.activeGroupId) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="version-history-diff-detail">
      <div className="flex items-center justify-between gap-2 text-[11px] text-ss-text-secondary">
        <span>
          {preview.loadedDetailCount} loaded across {preview.loadedDetailPageCount} pages
        </span>
        {preview.hasMoreDetail ? <span>More available</span> : null}
      </div>
      <VirtualDetailList items={preview.detailItems} />
      {preview.hasMoreDetail ? (
        <button
          type="button"
          data-testid="version-history-diff-load-more-detail"
          onClick={onLoadMoreDetail}
          disabled={preview.loadingDetail}
          className="h-8 rounded-sm border border-ss-border bg-ss-surface px-2 text-[11px] font-medium text-ss-text hover:bg-ss-surface-hover disabled:opacity-50"
        >
          {preview.loadingDetail ? 'Loading detail' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}

function VirtualDetailList({
  items,
}: {
  readonly items: readonly VersionDiffEntry[];
}): React.JSX.Element {
  const rowHeight = 92;
  const viewportHeight = 276;
  const [scrollTop, setScrollTop] = useState(0);
  const visible = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
    const count = Math.ceil(viewportHeight / rowHeight) + 4;
    return {
      start,
      end: Math.min(items.length, start + count),
    };
  }, [items.length, scrollTop]);
  const visibleItems = items.slice(visible.start, visible.end);

  return (
    <div
      className="relative overflow-y-auto rounded-sm border border-ss-border bg-ss-surface"
      style={{ height: viewportHeight }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      data-testid="version-history-diff-detail-viewport"
      data-visible-count={visibleItems.length}
      data-total-loaded={items.length}
    >
      <div className="m-0 p-0" style={{ height: items.length * rowHeight, position: 'relative' }}>
        {visibleItems.map((entry, index) => (
          <div
            key={diffEntryKey(entry, visible.start + index)}
            style={{
              position: 'absolute',
              top: (visible.start + index) * rowHeight,
              left: 0,
              right: 0,
              height: rowHeight,
              padding: 4,
            }}
          >
            <DiffChangeRow entry={entry} />
          </div>
        ))}
      </div>
    </div>
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

function WorkingTreeRange({
  page,
}: {
  readonly page: VersionWorkingTreeDiffPage;
}): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-sm border border-ss-border bg-ss-surface px-2 py-0.5 text-[10px] text-ss-text-secondary">
      <span className="sr-only">
        Working tree base {shortCommitId(page.baseCommitId)} current semantic state{' '}
        {page.currentSemanticStateDigest.digest}
      </span>
      <div className="truncate font-mono" aria-hidden="true">
        {shortCommitId(page.baseCommitId)}...working tree
      </div>
    </div>
  );
}

function DiffChangeRow({ entry }: { readonly entry: VersionDiffEntry }): React.JSX.Element {
  return (
    <article className="overflow-hidden rounded-sm border border-ss-border bg-ss-surface">
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
    </article>
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

function formatSummaryCount(summary: VersionDiffOverview['summary']): string {
  if (summary.exactTotalChanges !== undefined) {
    return `${summary.exactTotalChanges} ${
      summary.exactTotalChanges === 1 ? 'change' : 'changes'
    }`;
  }
  if (summary.minimumChangeCount !== undefined) return `${summary.minimumChangeCount}+ changes`;
  if (summary.totalEstimate !== undefined) return `About ${summary.totalEstimate} changes`;
  return 'Change count unavailable';
}

function formatGroupTitle(group: VersionDiffGroup): string {
  const address = formatDisplayValue(group.address);
  const sheetName = formatDisplayValue(group.sheetName);
  if (sheetName && address) return `${sheetName} ${address}`;
  if (address) return address;
  if (group.sheetId && group.kind !== 'domain') return `${group.sheetId} ${group.kind}`;
  return `${group.domain} ${group.kind}`;
}

function formatGroupCount(group: VersionDiffGroup): string {
  if (group.changeCount !== undefined) return String(group.changeCount);
  if (group.minimumChangeCount !== undefined) return `${group.minimumChangeCount}+`;
  if (group.totalEstimate !== undefined) return `~${group.totalEstimate}`;
  return '?';
}

function diffEntryKey(entry: VersionDiffEntry, index: number): string {
  if (entry.structural.kind === 'metadata') return entry.structural.changeId;
  return `${versionDiffEntryLabel(entry)}-${index}`;
}
