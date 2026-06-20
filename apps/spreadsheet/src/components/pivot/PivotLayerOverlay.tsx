import { ChevronDownSvg } from '@mog/icons';
import { useEffect, useRef, useState } from 'react';
import type { CellError, CellValue } from '@mog-sdk/contracts/core';
import type {
  PivotFieldItems,
  PivotItemInfo,
  PlacementId,
  SortOrder,
} from '@mog-sdk/contracts/pivot';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@mog/shell/components/ui';

import type {
  PivotOverlayDismissReason,
  PivotTransientOverlay,
} from '../../ui-store/slices/dialogs/pivot-dialog';
import { pivotReadbackAttributes } from '../../systems/pivot';
import {
  hasPivotFilterPlacements,
  hasPivotOutputPlacements,
  type PivotFieldHeaderControlLayout,
  type PivotMarker,
  type PivotReportFilterControlLayout,
} from './pivot-layer-layout';

interface PivotLayerOverlayProps {
  marker: PivotMarker;
  openTransientOverlay: PivotTransientOverlay;
  onOpenPivotOverlay: (overlay: Exclude<PivotTransientOverlay, null>) => void;
  onClosePivotOverlays: (reason: PivotOverlayDismissReason) => void;
  onApplyHeaderSort: (
    marker: PivotMarker,
    control: PivotFieldHeaderControlLayout,
    sortOrder: SortOrder | null,
  ) => void;
  onStartEditingPivot: (pivotId: string) => void;
  onRestoreGridFocus: () => void;
}

export function PivotLayerOverlay({
  marker,
  openTransientOverlay,
  onOpenPivotOverlay,
  onClosePivotOverlays,
  onApplyHeaderSort,
  onStartEditingPivot,
  onRestoreGridFocus,
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
          openTransientOverlay={openTransientOverlay}
          onOpenPivotOverlay={onOpenPivotOverlay}
          onClosePivotOverlays={onClosePivotOverlays}
          onApplyHeaderSort={onApplyHeaderSort}
          onStartEditingPivot={onStartEditingPivot}
          onRestoreGridFocus={onRestoreGridFocus}
        />
      )}
      {showFilterControls && (
        <ReportFilterControls
          marker={marker}
          openTransientOverlay={openTransientOverlay}
          onOpenPivotOverlay={onOpenPivotOverlay}
          onClosePivotOverlays={onClosePivotOverlays}
          onRestoreGridFocus={onRestoreGridFocus}
        />
      )}
      {showEmptyState && (
        <PivotEmptyState marker={marker} onStartEditingPivot={onStartEditingPivot} />
      )}
    </div>
  );
}

function PivotHeaderControls({
  marker,
  openTransientOverlay,
  onOpenPivotOverlay,
  onClosePivotOverlays,
  onApplyHeaderSort,
  onStartEditingPivot,
  onRestoreGridFocus,
}: PivotLayerOverlayProps) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {marker.fieldHeaderControls.map((control) => (
        <PivotHeaderControl
          key={control.placementId}
          marker={marker}
          control={control}
          isOpen={
            openTransientOverlay?.kind === 'field-header-menu' &&
            openTransientOverlay.pivotId === marker.id &&
            openTransientOverlay.placementId === control.placementId
          }
          onOpenPivotOverlay={onOpenPivotOverlay}
          onClosePivotOverlays={onClosePivotOverlays}
          onApplyHeaderSort={onApplyHeaderSort}
          onStartEditingPivot={onStartEditingPivot}
          onRestoreGridFocus={onRestoreGridFocus}
        />
      ))}
    </div>
  );
}

interface PivotHeaderControlProps {
  marker: PivotMarker;
  control: PivotFieldHeaderControlLayout;
  isOpen: boolean;
  onOpenPivotOverlay: (overlay: Exclude<PivotTransientOverlay, null>) => void;
  onClosePivotOverlays: (reason: PivotOverlayDismissReason) => void;
  onApplyHeaderSort: (
    marker: PivotMarker,
    control: PivotFieldHeaderControlLayout,
    sortOrder: SortOrder | null,
  ) => void;
  onStartEditingPivot: (pivotId: string) => void;
  onRestoreGridFocus: () => void;
}

function PivotHeaderControl({
  marker,
  control,
  isOpen,
  onOpenPivotOverlay,
  onClosePivotOverlays,
  onApplyHeaderSort,
  onStartEditingPivot,
  onRestoreGridFocus,
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
      <DropdownMenu
        modal={false}
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            onOpenPivotOverlay({
              kind: 'field-header-menu',
              pivotId: marker.id,
              placementId: control.placementId,
            });
          } else if (isOpen) {
            onClosePivotOverlays('outside-pointer');
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="pointer-events-auto absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded border border-ss-border bg-ss-surface/95 text-ss-text-secondary shadow-sm hover:bg-ss-surface-hover disabled:opacity-50"
            data-no-grid-pointer="true"
            data-pivot-target="pivot-field-header-control"
            data-pivot-area={control.area}
            data-pivot-field-id={control.fieldId}
            data-pivot-placement-id={control.placementId}
            data-pivot-row={control.row}
            data-pivot-col={control.col}
            title={`${control.label} field menu`}
            aria-label={`${control.label} field menu`}
            disabled={!marker.pivot.capabilities.canEditFields}
          >
            <ChevronDownSvg className="h-3 w-3" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <PivotHeaderMenu
          marker={marker}
          control={control}
          canSort={canSort}
          onClosePivotOverlays={onClosePivotOverlays}
          onApplyHeaderSort={onApplyHeaderSort}
          onStartEditingPivot={onStartEditingPivot}
          onRestoreGridFocus={onRestoreGridFocus}
        />
      </DropdownMenu>
    </div>
  );
}

interface PivotHeaderMenuProps {
  marker: PivotMarker;
  control: PivotFieldHeaderControlLayout;
  canSort: boolean;
  onClosePivotOverlays: (reason: PivotOverlayDismissReason) => void;
  onApplyHeaderSort: (
    marker: PivotMarker,
    control: PivotFieldHeaderControlLayout,
    sortOrder: SortOrder | null,
  ) => void;
  onStartEditingPivot: (pivotId: string) => void;
  onRestoreGridFocus: () => void;
}

function PivotHeaderMenu({
  marker,
  control,
  canSort,
  onClosePivotOverlays,
  onApplyHeaderSort,
  onStartEditingPivot,
  onRestoreGridFocus,
}: PivotHeaderMenuProps) {
  const restoreGridFocusOnCloseRef = useRef(false);

  const restoreGridFocusOnClose = () => {
    restoreGridFocusOnCloseRef.current = true;
  };

  return (
    <DropdownMenuContent
      align="end"
      side="bottom"
      sideOffset={4}
      className="min-w-36 p-1 text-caption"
      data-no-grid-pointer="true"
      data-pivot-target="pivot-field-header-menu"
      data-pivot-area={control.area}
      data-pivot-field-id={control.fieldId}
      data-pivot-placement-id={control.placementId}
      onEscapeKeyDown={() => {
        restoreGridFocusOnClose();
        onClosePivotOverlays('escape');
      }}
      onCloseAutoFocus={(event) => {
        if (!restoreGridFocusOnCloseRef.current) return;
        restoreGridFocusOnCloseRef.current = false;
        event.preventDefault();
        onRestoreGridFocus();
      }}
    >
      <DropdownMenuItem
        disabled={!canSort}
        onSelect={() => {
          restoreGridFocusOnClose();
          onApplyHeaderSort(marker, control, 'asc');
        }}
      >
        Sort Ascending
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!canSort}
        onSelect={() => {
          restoreGridFocusOnClose();
          onApplyHeaderSort(marker, control, 'desc');
        }}
      >
        Sort Descending
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!canSort}
        onSelect={() => {
          restoreGridFocusOnClose();
          onApplyHeaderSort(marker, control, null);
        }}
      >
        Clear Sort
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          restoreGridFocusOnClose();
          onStartEditingPivot(marker.id);
        }}
      >
        Field Settings
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

function ReportFilterControls({
  marker,
  openTransientOverlay,
  onOpenPivotOverlay,
  onClosePivotOverlays,
  onRestoreGridFocus,
}: {
  marker: PivotMarker;
  openTransientOverlay: PivotTransientOverlay;
  onOpenPivotOverlay: (overlay: Exclude<PivotTransientOverlay, null>) => void;
  onClosePivotOverlays: (reason: PivotOverlayDismissReason) => void;
  onRestoreGridFocus: () => void;
}) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {marker.reportFilterControls.map((control) => (
        <ReportFilterControl
          key={control.placementId}
          control={control}
          marker={marker}
          isOpen={
            openTransientOverlay?.kind === 'report-filter-menu' &&
            openTransientOverlay.pivotId === marker.id &&
            openTransientOverlay.placementId === control.placementId
          }
          onOpenPivotOverlay={onOpenPivotOverlay}
          onClosePivotOverlays={onClosePivotOverlays}
          onRestoreGridFocus={onRestoreGridFocus}
        />
      ))}
    </div>
  );
}

function ReportFilterControl({
  control,
  marker,
  isOpen,
  onOpenPivotOverlay,
  onClosePivotOverlays,
  onRestoreGridFocus,
}: {
  control: PivotReportFilterControlLayout;
  marker: PivotMarker;
  isOpen: boolean;
  onOpenPivotOverlay: (overlay: Exclude<PivotTransientOverlay, null>) => void;
  onClosePivotOverlays: (reason: PivotOverlayDismissReason) => void;
  onRestoreGridFocus: () => void;
}) {
  const [items, setItems] = useState<PivotItemInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const restoreGridFocusOnCloseRef = useRef(false);
  const activeFilter = marker.pivot.config.filters.find(
    (filter) => filter.fieldId === control.fieldId,
  );
  const filterSummary = summarizeReportFilter(activeFilter, items);

  const restoreGridFocusOnClose = () => {
    restoreGridFocusOnCloseRef.current = true;
  };

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
    restoreGridFocusOnClose();
    onClosePivotOverlays('command-applied');
    void marker.pivot.handle?.removeFilter(control.fieldId);
  };

  const includeSingleValue = (value: CellValue) => {
    restoreGridFocusOnClose();
    onClosePivotOverlays('command-applied');
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
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            onOpenPivotOverlay({
              kind: 'report-filter-menu',
              pivotId: marker.id,
              placementId: control.placementId,
            });
          } else if (isOpen) {
            onClosePivotOverlays('outside-pointer');
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="pointer-events-auto inline-flex max-w-full min-w-0 items-center gap-1 rounded border border-ss-border bg-ss-surface/95 px-2 py-1 text-caption text-ss-text-primary shadow-sm hover:bg-ss-surface-hover"
            data-no-grid-pointer="true"
            data-pivot-target="report-filter-control"
            data-pivot-field-id={control.fieldId}
            data-pivot-placement-id={control.placementId}
            data-pivot-row={control.row}
            title={`Filter ${control.label}: ${filterSummary}`}
            aria-label={`Filter ${control.label}: ${filterSummary}`}
            aria-haspopup="listbox"
            aria-expanded={isOpen ? 'true' : 'false'}
          >
            <span className="min-w-0 truncate">{control.label}</span>
            <span className="shrink-0 text-ss-text-secondary">{filterSummary}</span>
            <span className="shrink-0 text-ss-text-secondary" aria-hidden="true">
              v
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          role="listbox"
          align="start"
          side="bottom"
          sideOffset={4}
          className="pivot-report-filter-picker flex max-h-72 min-w-44 flex-col overflow-auto p-1 text-caption"
          data-no-grid-pointer="true"
          data-pivot-target="report-filter-picker"
          data-pivot-field-id={control.fieldId}
          data-pivot-placement-id={control.placementId}
          aria-label={`${control.label} filter values`}
          onEscapeKeyDown={() => {
            restoreGridFocusOnClose();
            onClosePivotOverlays('escape');
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            if (!restoreGridFocusOnCloseRef.current) return;
            restoreGridFocusOnCloseRef.current = false;
            event.preventDefault();
            onRestoreGridFocus();
          }}
        >
          <div
            className="flex flex-col"
            data-no-grid-pointer="true"
            data-pivot-target="report-filter-picker"
            data-pivot-field-id={control.fieldId}
            data-pivot-placement-id={control.placementId}
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
        </PopoverContent>
      </Popover>
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
    const visibleCount =
      items.length > 0 ? Math.max(0, items.length - filter.excludeValues.length) : 0;
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
      data-no-grid-pointer="true"
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
