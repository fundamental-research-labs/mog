import { ChevronDownSvg } from '@mog/icons';
import { useEffect, useState } from 'react';
import type { CellError, CellValue } from '@mog-sdk/contracts/core';
import type { PivotFieldItems, PivotItemInfo, PlacementId, SortOrder } from '@mog-sdk/contracts/pivot';

import { pivotReadbackAttributes } from '../../systems/pivot';
import {
  hasPivotFilterPlacements,
  hasPivotOutputPlacements,
  type PivotFieldHeaderControlLayout,
  type PivotMarker,
  type PivotReportFilterControlLayout,
} from './pivot-layer-layout';

export interface OpenPivotHeaderMenu {
  pivotId: string;
  placementId: PlacementId;
}

interface PivotLayerOverlayProps {
  marker: PivotMarker;
  openHeaderMenu: OpenPivotHeaderMenu | null;
  onToggleHeaderMenu: (menu: OpenPivotHeaderMenu | null) => void;
  onApplyHeaderSort: (
    marker: PivotMarker,
    control: PivotFieldHeaderControlLayout,
    sortOrder: SortOrder | null,
  ) => void;
  onStartEditingPivot: (pivotId: string) => void;
}

export function PivotLayerOverlay({
  marker,
  openHeaderMenu,
  onToggleHeaderMenu,
  onApplyHeaderSort,
  onStartEditingPivot,
}: PivotLayerOverlayProps) {
  const config = marker.pivot.config;
  const showEmptyState = !hasPivotOutputPlacements(config);
  const showFilterControls = hasPivotFilterPlacements(config);
  const showHeaderControls = marker.fieldHeaderControls.length > 0;
  if (!showEmptyState && !showFilterControls && !showHeaderControls) return null;

  const overlayWidth = showEmptyState
    ? Math.max(marker.rect.width, 280)
    : Math.max(marker.rect.width, 220);
  const overlayHeight = showEmptyState
    ? Math.max(marker.rect.height, 132)
    : Math.max(marker.rect.height, 36);

  return (
    <div
      key={`${marker.id}-visible-overlay`}
      data-pivot-target="table-view"
      data-pivot-layer-overlay="true"
      data-pivot-id={marker.id}
      data-pivot-name={marker.name}
      {...pivotReadbackAttributes(config)}
      style={{
        position: 'fixed',
        left: marker.rect.x,
        top: marker.rect.y,
        width: overlayWidth,
        minHeight: overlayHeight,
        pointerEvents:
          showEmptyState ||
          marker.reportFilterControls.length > 0 ||
          marker.fieldHeaderControls.length > 0
            ? 'auto'
            : 'none',
        zIndex: 6,
      }}
    >
      {showHeaderControls && (
        <PivotHeaderControls
          marker={marker}
          openHeaderMenu={openHeaderMenu}
          onToggleHeaderMenu={onToggleHeaderMenu}
          onApplyHeaderSort={onApplyHeaderSort}
          onStartEditingPivot={onStartEditingPivot}
        />
      )}
      {showFilterControls && <ReportFilterControls marker={marker} />}
      {showEmptyState && (
        <PivotEmptyState marker={marker} onStartEditingPivot={onStartEditingPivot} />
      )}
    </div>
  );
}

function PivotHeaderControls({
  marker,
  openHeaderMenu,
  onToggleHeaderMenu,
  onApplyHeaderSort,
  onStartEditingPivot,
}: PivotLayerOverlayProps) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {marker.fieldHeaderControls.map((control) => (
        <PivotHeaderControl
          key={control.placementId}
          marker={marker}
          control={control}
          isOpen={
            openHeaderMenu?.pivotId === marker.id &&
            openHeaderMenu?.placementId === control.placementId
          }
          onToggleHeaderMenu={onToggleHeaderMenu}
          onApplyHeaderSort={onApplyHeaderSort}
          onStartEditingPivot={onStartEditingPivot}
        />
      ))}
    </div>
  );
}

interface PivotHeaderControlProps {
  marker: PivotMarker;
  control: PivotFieldHeaderControlLayout;
  isOpen: boolean;
  onToggleHeaderMenu: (menu: OpenPivotHeaderMenu | null) => void;
  onApplyHeaderSort: (
    marker: PivotMarker,
    control: PivotFieldHeaderControlLayout,
    sortOrder: SortOrder | null,
  ) => void;
  onStartEditingPivot: (pivotId: string) => void;
}

function PivotHeaderControl({
  marker,
  control,
  isOpen,
  onToggleHeaderMenu,
  onApplyHeaderSort,
  onStartEditingPivot,
}: PivotHeaderControlProps) {
  const canSort = marker.pivot.capabilities.canSortLabels;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: control.rect.x,
        top: control.rect.y,
        width: control.rect.width,
        height: control.rect.height,
      }}
    >
      <button
        type="button"
        className="pointer-events-auto absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded border border-ss-border bg-ss-surface/95 text-ss-text-secondary shadow-sm hover:bg-ss-surface-hover disabled:opacity-50"
        data-pivot-target="pivot-field-header-control"
        data-pivot-area={control.area}
        data-pivot-field-id={control.fieldId}
        data-pivot-placement-id={control.placementId}
        data-pivot-row={control.row}
        data-pivot-col={control.col}
        aria-haspopup="menu"
        aria-expanded={isOpen ? 'true' : 'false'}
        title={`${control.label} field menu`}
        aria-label={`${control.label} field menu`}
        disabled={!marker.pivot.capabilities.canEditFields}
        onClick={(event) => {
          event.stopPropagation();
          onToggleHeaderMenu(
            isOpen ? null : { pivotId: marker.id, placementId: control.placementId },
          );
        }}
      >
        <ChevronDownSvg className="h-3 w-3" aria-hidden="true" />
      </button>
      {isOpen && (
        <PivotHeaderMenu
          marker={marker}
          control={control}
          canSort={canSort}
          onApplyHeaderSort={onApplyHeaderSort}
          onStartEditingPivot={onStartEditingPivot}
        />
      )}
    </div>
  );
}

interface PivotHeaderMenuProps {
  marker: PivotMarker;
  control: PivotFieldHeaderControlLayout;
  canSort: boolean;
  onApplyHeaderSort: (
    marker: PivotMarker,
    control: PivotFieldHeaderControlLayout,
    sortOrder: SortOrder | null,
  ) => void;
  onStartEditingPivot: (pivotId: string) => void;
}

function PivotHeaderMenu({
  marker,
  control,
  canSort,
  onApplyHeaderSort,
  onStartEditingPivot,
}: PivotHeaderMenuProps) {
  return (
    <div
      role="menu"
      className="pointer-events-auto absolute right-0 top-6 z-10 flex min-w-36 flex-col rounded border border-ss-border bg-ss-surface p-1 text-caption text-ss-text-primary shadow-lg"
      data-pivot-target="pivot-field-header-menu"
      data-pivot-area={control.area}
      data-pivot-field-id={control.fieldId}
      data-pivot-placement-id={control.placementId}
    >
      <HeaderMenuButton
        disabled={!canSort}
        onClick={() => onApplyHeaderSort(marker, control, 'asc')}
      >
        Sort Ascending
      </HeaderMenuButton>
      <HeaderMenuButton
        disabled={!canSort}
        onClick={() => onApplyHeaderSort(marker, control, 'desc')}
      >
        Sort Descending
      </HeaderMenuButton>
      <HeaderMenuButton
        disabled={!canSort}
        onClick={() => onApplyHeaderSort(marker, control, null)}
      >
        Clear Sort
      </HeaderMenuButton>
      <HeaderMenuButton onClick={() => onStartEditingPivot(marker.id)}>
        Field Settings
      </HeaderMenuButton>
    </div>
  );
}

function HeaderMenuButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="rounded px-2 py-1 text-left hover:bg-ss-surface-hover disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ReportFilterControls({
  marker,
}: {
  marker: PivotMarker;
}) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {marker.reportFilterControls.map((control) => (
        <ReportFilterControl
          key={control.placementId}
          control={control}
          marker={marker}
        />
      ))}
    </div>
  );
}

function ReportFilterControl({
  control,
  marker,
}: {
  control: PivotReportFilterControlLayout;
  marker: PivotMarker;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<PivotItemInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const activeFilter = marker.pivot.config.filters.find(
    (filter) => filter.fieldId === control.fieldId,
  );
  const filterSummary = summarizeReportFilter(activeFilter, items);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const handle = marker.pivot.handle;
    if (!handle) {
      setItems([]);
      return;
    }

    setIsLoading(true);
    void handle
      .getAllItems()
      .then((groups) => {
        if (cancelled) return;
        setItems(filterItemsForControl(groups, control));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [control, isOpen, marker.pivot.handle]);

  const clearFilter = () => {
    setIsOpen(false);
    void marker.pivot.handle?.removeFilter(control.fieldId);
  };

  const includeSingleValue = (value: CellValue) => {
    setIsOpen(false);
    void marker.pivot.handle?.setFilter(control.fieldId, { includeValues: [value] });
  };

  return (
    <div
      className="absolute flex items-start pointer-events-none"
      style={{
        left: control.rect.x,
        top: control.rect.y,
        height: control.rect.height,
      }}
    >
      <button
        type="button"
        className="pointer-events-auto inline-flex max-w-full min-w-0 items-center gap-1 rounded border border-ss-border bg-ss-surface/95 px-2 py-1 text-caption text-ss-text-primary shadow-sm hover:bg-ss-surface-hover"
        data-pivot-target="report-filter-control"
        data-pivot-field-id={control.fieldId}
        data-pivot-placement-id={control.placementId}
        data-pivot-row={control.row}
        title={`Filter ${control.label}: ${filterSummary}`}
        aria-label={`Filter ${control.label}: ${filterSummary}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen ? 'true' : 'false'}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((open) => !open);
        }}
      >
        <span className="min-w-0 truncate">{control.label}</span>
        <span className="shrink-0 text-ss-text-secondary">{filterSummary}</span>
        <span className="shrink-0 text-ss-text-secondary" aria-hidden="true">
          v
        </span>
      </button>
      {isOpen && (
        <div
          role="listbox"
          className="pointer-events-auto absolute left-0 top-full z-20 mt-1 flex max-h-72 min-w-44 flex-col overflow-auto rounded border border-ss-border bg-ss-surface p-1 text-caption text-ss-text-primary shadow-lg"
          data-pivot-target="report-filter-picker"
          data-pivot-field-id={control.fieldId}
          data-pivot-placement-id={control.placementId}
          aria-label={`${control.label} filter values`}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="option"
            aria-selected={!activeFilter}
            className="rounded px-2 py-1 text-left hover:bg-ss-surface-hover"
            data-pivot-target="report-filter-option"
            data-pivot-filter-option="all"
            onClick={clearFilter}
          >
            All
          </button>
          {isLoading && (
            <div className="px-2 py-1 text-ss-text-secondary" data-pivot-target="filter-loading">
              Loading
            </div>
          )}
          {!isLoading &&
            items.map((item) => {
              const label = formatFilterValue(item.value);
              const selected = isValueIncluded(activeFilter, item.value);
              return (
                <button
                  key={String(item.key)}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="rounded px-2 py-1 text-left hover:bg-ss-surface-hover"
                  data-pivot-target="report-filter-option"
                  data-pivot-filter-option={label}
                  onClick={() => includeSingleValue(item.value)}
                >
                  {label}
                </button>
              );
            })}
          {!isLoading && items.length === 0 && (
            <div className="px-2 py-1 text-ss-text-secondary" data-pivot-target="filter-empty">
              No values
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function filterItemsForControl(
  groups: PivotFieldItems[],
  control: PivotReportFilterControlLayout,
): PivotItemInfo[] {
  const group = groups.find(
    (candidate) => candidate.fieldId === control.fieldId || candidate.fieldName === control.label,
  );
  return (
    group?.items.filter((item) => !item.isSubtotal && !item.isGrandTotal && item.isVisible) ?? []
  );
}

function isCellError(value: CellValue): value is CellError {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'error';
}

function formatFilterValue(value: CellValue): string {
  if (value == null) return '(blank)';
  if (isCellError(value)) return value.message ?? value.value;
  return String(value);
}

function cellValueKey(value: CellValue): string {
  return isCellError(value)
    ? `error:${value.value}:${value.message ?? ''}`
    : `${typeof value}:${String(value)}`;
}

function isValueIncluded(
  filter: PivotMarker['pivot']['config']['filters'][number] | undefined,
  value: CellValue,
): boolean {
  if (!filter) return true;
  const valueKey = cellValueKey(value);
  if (filter.includeValues) {
    return filter.includeValues.some((entry) => cellValueKey(entry) === valueKey);
  }
  if (filter.excludeValues) {
    return !filter.excludeValues.some((entry) => cellValueKey(entry) === valueKey);
  }
  return true;
}

function summarizeReportFilter(
  filter: PivotMarker['pivot']['config']['filters'][number] | undefined,
  items: PivotItemInfo[],
): string {
  if (!filter) return 'All';
  if (filter.includeValues?.length === 1) return formatFilterValue(filter.includeValues[0]);
  if (filter.includeValues && filter.includeValues.length > 1) {
    return `${filter.includeValues.length} selected`;
  }
  if (filter.excludeValues && filter.excludeValues.length > 0) {
    const visibleCount = items.length > 0 ? Math.max(0, items.length - filter.excludeValues.length) : 0;
    return items.length > 0 ? `${visibleCount} selected` : 'Filtered';
  }
  return 'All';
}

function PivotEmptyState({
  marker,
  onStartEditingPivot,
}: {
  marker: PivotMarker;
  onStartEditingPivot: (pivotId: string) => void;
}) {
  return (
    <button
      type="button"
      className="mt-2 flex h-full min-h-[120px] w-full flex-col items-start justify-center rounded border border-dashed border-ss-border bg-ss-surface/95 px-4 py-3 text-left shadow-sm hover:bg-ss-surface-hover"
      data-pivot-target="empty-state"
      data-pivot-id={marker.id}
      title={`Configure ${marker.name}`}
      aria-label={`Configure empty pivot table ${marker.name}`}
      onClick={() => onStartEditingPivot(marker.id)}
    >
      <span
        className="text-subtitle font-semibold text-ss-text-primary"
        data-pivot-target="empty-state-name"
      >
        {marker.name}
      </span>
      <span className="mt-1 text-body-sm text-ss-text-secondary">
        Add row, column, or value fields to build this pivot table.
      </span>
    </button>
  );
}
