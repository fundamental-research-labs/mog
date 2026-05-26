/**
 * Pivot Layer Component
 *
 * Renders pivot tables over the spreadsheet grid using pure React positioning.
 * Pivot tables are positioned in DOCUMENT SPACE - the container handles scroll via CSS transform.
 *
 * Architecture:
 * - Position in document space using ISheetViewGeometry.getCellPageRect()
 * - Container applies scroll transform imperatively (no React re-render on scroll)
 * - 60fps GPU-accelerated scrolling via CSS translate3d
 *
 * @see PIVOT-CHART-LAYER-NOT-RENDERED.md for architecture decisions
 * @module components/PivotLayer
 */

import React, { useCallback } from 'react';

import type { ISheetViewGeometry } from '@mog-sdk/sheet-view';
import type { PivotTableWithResult } from '@mog-sdk/contracts/pivot';
import PivotTableView from './PivotTableView';

// =============================================================================
// Types
// =============================================================================

/**
 * Pivot table position (in cell coordinates)
 */
export interface PivotPosition {
  /** Anchor row (0-indexed) */
  anchorRow: number;
  /** Anchor column (0-indexed) */
  anchorCol: number;
  /** Width in cells */
  widthCells: number;
  /** Height in cells */
  heightCells: number;
}

/**
 * Context menu event info for pivot table
 */
export interface PivotContextMenuEvent {
  /** Client X position */
  x: number;
  /** Client Y position */
  y: number;
  /** Pivot table ID */
  pivotId: string;
  /** Header key if right-clicking on a header */
  headerKey?: string;
  /** Field ID if right-clicking on a specific field */
  fieldId?: string;
  /** Whether this is a row header (vs column header) */
  isRowHeader?: boolean;
}

/**
 * Props for PivotLayer component.
 *
 * ARCHITECTURE: Pivots are positioned in DOCUMENT SPACE.
 * The parent container (PivotLayerContainer) handles scroll via CSS transform.
 * This avoids React re-renders on scroll for 60fps performance.
 */
export interface PivotLayerProps {
  /**
   * Geometry capability for converting cell positions to document pixels.
   * Uses getCellPageRect() for scroll-independent positioning.
   */
  geometry: ISheetViewGeometry;
  /** Pivot tables to render */
  pivotTables: PivotTableWithResult[];
  /** Called when a pivot is selected */
  onPivotSelect?: (pivotId: string | null) => void;
  /** Currently selected pivot ID */
  selectedPivotId?: string | null;
  /** Called when expand/collapse toggle occurs */
  onToggleExpand?: (pivotId: string, headerKey: string, isRow: boolean) => void;
  /** Called when drill-down occurs */
  onDrillDown?: (pivotId: string, rowKey: string, columnKey: string) => void;
  /** Called when user wants to edit pivot (double-click) - opens field panel */
  onPivotEdit?: (pivotId: string) => void;
  /** Called when user right-clicks on a pivot (context menu) */
  onPivotContextMenu?: (event: PivotContextMenuEvent) => void;
}

// =============================================================================
// Memoized Pivot Wrapper
// =============================================================================

interface PivotWrapperProps {
  pivot: PivotTableWithResult;
  anchorRow: number;
  anchorCol: number;
  left: number;
  top: number;
  width: number;
  height: number;
  isSelected: boolean;
  onSelect: (pivotId: string) => void;
  onDoubleClick: (pivotId: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleExpand?: (headerKey: string, isRow: boolean) => void;
  onCellClick?: (rowKey: string, columnKey: string) => void;
  onOpenFieldPanel?: () => void;
}

/**
 * Memoized wrapper to prevent unnecessary re-renders on scroll.
 * Only re-renders when pivot data/config changes, not position.
 */
const PivotWrapper = React.memo(
  function PivotWrapper({
    pivot,
    anchorRow,
    anchorCol,
    left,
    top,
    width,
    height,
    isSelected,
    onSelect,
    onDoubleClick,
    onContextMenu,
    onToggleExpand,
    onCellClick,
    onOpenFieldPanel,
  }: PivotWrapperProps) {
    // Create an empty result for rendering if none exists
    const result = pivot.result ?? {
      columnHeaders: [],
      rows: [],
      grandTotals: {},
      sourceRowCount: 0,
      renderedBounds: {
        totalRows: 0,
        totalCols: 0,
        firstDataRow: 0,
        firstDataCol: 0,
        numDataCols: 0,
      },
    };

    return (
      <div
        className="absolute pointer-events-auto overflow-auto"
        style={{
          transform: `translate3d(${left}px, ${top}px, 0)`,
          width,
          height,
          willChange: 'transform',
        }}
        data-pivot-target="wrapper"
        data-pivot-id={pivot.config.id}
        data-pivot-name={pivot.config.name}
        data-testid={`pivot-wrapper-${pivot.config.id}`}
        data-pivot-anchor-row={anchorRow}
        data-pivot-anchor-col={anchorCol}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(pivot.config.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick(pivot.config.id);
        }}
        onContextMenu={(e) => {
          // Do NOT call e.preventDefault() or e.stopPropagation() — let the
          // event bubble to the Radix ContextMenuTrigger on PivotLayerContainer
          // so Radix can handle positioning and open/close state natively.
          onContextMenu(e);
        }}
      >
        <PivotTableView
          config={pivot.config}
          result={result}
          isSelected={isSelected}
          onToggleExpand={onToggleExpand}
          onCellClick={onCellClick}
          onOpenFieldPanel={onOpenFieldPanel}
          className="w-full h-full"
        />
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison: position changes are handled via style, not re-render
    // Only re-render if pivot content or selection changes
    return (
      prevProps.pivot.config.id === nextProps.pivot.config.id &&
      prevProps.pivot.config === nextProps.pivot.config &&
      prevProps.pivot.result === nextProps.pivot.result &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.left === nextProps.left &&
      prevProps.top === nextProps.top &&
      prevProps.width === nextProps.width &&
      prevProps.height === nextProps.height
    );
  },
);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate pivot position in DOCUMENT SPACE using geometry capability.
 *
 * This returns absolute document coordinates WITHOUT scroll offset.
 * The container's CSS transform handles scroll, not the position calculation.
 *
 * @param position - Cell-based pivot position
 * @param geometry - Geometry capability for coordinate conversions
 * @returns Document-space pixel position
 */
function getPivotDocumentPosition(
  position: PivotPosition,
  geometry: ISheetViewGeometry,
): { left: number; top: number; width: number; height: number } {
  // Get anchor cell position in page space (document space, NO scroll offset)
  const anchorRect = geometry.getCellPageRect({
    row: position.anchorRow,
    col: position.anchorCol,
  });

  // Calculate width/height spanning multiple cells via position dimensions
  const pd = geometry.getPositionDimensions();
  let width = 0;
  for (let c = 0; c < position.widthCells; c++) {
    width += pd.getColWidth(position.anchorCol + c);
  }
  let height = 0;
  for (let r = 0; r < position.heightCells; r++) {
    height += pd.getRowHeight(position.anchorRow + r);
  }

  return {
    left: anchorRect?.x ?? 0,
    top: anchorRect?.y ?? 0,
    width,
    height,
  };
}

// =============================================================================
// Component
// =============================================================================

export function PivotLayer({
  geometry,
  pivotTables,
  onPivotSelect,
  selectedPivotId,
  onToggleExpand,
  onDrillDown,
  onPivotEdit,
  onPivotContextMenu,
}: PivotLayerProps) {
  // Handle pivot selection
  const handlePivotSelect = useCallback(
    (pivotId: string) => {
      onPivotSelect?.(pivotId);
    },
    [onPivotSelect],
  );

  // Handle background click to deselect
  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      // Only deselect if clicking the background, not a pivot
      if (e.target === e.currentTarget) {
        onPivotSelect?.(null);
      }
    },
    [onPivotSelect],
  );

  // Handle pivot double-click to open field panel for editing
  const handlePivotDoubleClick = useCallback(
    (pivotId: string) => {
      onPivotEdit?.(pivotId);
    },
    [onPivotEdit],
  );

  // Handle pivot right-click for context menu
  const handlePivotContextMenu = useCallback(
    (pivotId: string, e: React.MouseEvent) => {
      if (onPivotContextMenu) {
        onPivotContextMenu({
          x: e.clientX,
          y: e.clientY,
          pivotId,
          // TODO: In future, detect header/field from event target
          // headerKey, fieldId, isRowHeader can be added based on what was clicked
        });
      }
    },
    [onPivotContextMenu],
  );

  // Render all pivot tables positioned in DOCUMENT SPACE
  // The parent container handles scroll via CSS transform
  // No visibility filtering here - overflow:hidden on container handles clipping
  return (
    <div
      onClick={handleBackgroundClick}
      className="absolute pointer-events-none"
      data-pivot-target="layer"
      data-testid="pivot-layer"
      style={{
        // Size to full document extent (not viewport) so pivots can be positioned anywhere
        // The container's overflow:hidden + transform handles visibility
        width: '100%',
        height: '100%',
      }}
    >
      {pivotTables.map((pivot) => {
        // Calculate position in DOCUMENT space (no scroll offset)
        // outputLocation is now REQUIRED in PivotTableConfig - no fallback needed.
        // Legacy pivots are migrated in Rust (deserializeConfig backfills outputLocation).
        const position: PivotPosition = {
          anchorRow: pivot.config.outputLocation.row,
          anchorCol: pivot.config.outputLocation.col,
          widthCells: 8, // Default pivot dimensions
          heightCells: 15,
        };
        const docPosition = getPivotDocumentPosition(position, geometry);

        return (
          <PivotWrapper
            key={pivot.config.id}
            pivot={pivot}
            anchorRow={position.anchorRow}
            anchorCol={position.anchorCol}
            left={docPosition.left}
            top={docPosition.top}
            width={docPosition.width}
            height={docPosition.height}
            isSelected={selectedPivotId === pivot.config.id}
            onSelect={handlePivotSelect}
            onDoubleClick={handlePivotDoubleClick}
            onContextMenu={(e) => handlePivotContextMenu(pivot.config.id, e)}
            onToggleExpand={
              onToggleExpand
                ? (headerKey, isRow) => onToggleExpand(pivot.config.id, headerKey, isRow)
                : undefined
            }
            onCellClick={
              onDrillDown
                ? (rowKey, columnKey) => onDrillDown(pivot.config.id, rowKey, columnKey)
                : undefined
            }
            onOpenFieldPanel={onPivotEdit ? () => onPivotEdit(pivot.config.id) : undefined}
          />
        );
      })}
    </div>
  );
}
