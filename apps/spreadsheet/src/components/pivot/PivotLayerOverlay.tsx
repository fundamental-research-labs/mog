import { ChevronDownSvg } from '@mog/icons';
import type { PlacementId, SortOrder } from '@mog-sdk/contracts/pivot';

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
      {showFilterControls && (
        <ReportFilterControls marker={marker} onStartEditingPivot={onStartEditingPivot} />
      )}
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
  onStartEditingPivot,
}: {
  marker: PivotMarker;
  onStartEditingPivot: (pivotId: string) => void;
}) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {marker.reportFilterControls.map((control) => (
        <ReportFilterControl
          key={control.placementId}
          control={control}
          pivotId={marker.id}
          onStartEditingPivot={onStartEditingPivot}
        />
      ))}
    </div>
  );
}

function ReportFilterControl({
  control,
  pivotId,
  onStartEditingPivot,
}: {
  control: PivotReportFilterControlLayout;
  pivotId: string;
  onStartEditingPivot: (pivotId: string) => void;
}) {
  return (
    <div
      className="absolute flex items-center pointer-events-none"
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
        title={`Filter ${control.label}: All`}
        aria-label={`Filter ${control.label}: All`}
        onClick={() => onStartEditingPivot(pivotId)}
      >
        <span className="min-w-0 truncate">{control.label}</span>
        <span className="shrink-0 text-ss-text-secondary">All</span>
        <span className="shrink-0 text-ss-text-secondary" aria-hidden="true">
          v
        </span>
      </button>
    </div>
  );
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
