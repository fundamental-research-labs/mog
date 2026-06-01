/**
 * Outline Renderer
 *
 * Renders row/column grouping outlines with:
 * - Level buttons (1, 2, 3, ...) in the corner gutter
 * - +/- collapse/expand buttons at summary row/column positions
 * - Vertical/horizontal bars connecting grouped rows/columns
 *
 * Row/Column Grouping outline renderer
 *
 * Uses typed data source adapters (not the deprecated monolithic RenderContext).
 */

import { DEFAULT_CELL_STYLE } from '@mog/spreadsheet-utils/cells/cell-style';
import type {
  GroupDefinition,
  OutlineLevel,
  SheetGroupingConfig,
} from '@mog-sdk/contracts/grouping';
import type {
  OutlineHitTestResult as ContractOutlineHitTestResult,
  CoordinateSystem,
  GroupingData,
  GroupingDataSource,
  HeaderVisibility,
  HitTestService,
  ScrollViewport,
} from '@mog-sdk/contracts/rendering';
import {
  DEFAULT_CHROME_THEME,
  getEffectiveHeaderDimensions,
  OUTLINE_BUTTON_SIZE,
  OUTLINE_LEVEL_HEIGHT,
  OUTLINE_LEVEL_WIDTH,
} from '../shared/constants';

// =============================================================================
// Constants
// =============================================================================

const OUTLINE_TEXT_COLOR = '#5f6368';
const OUTLINE_FONT_SIZE = 9;
const OUTLINE_BAR_COLOR = '#9aa0a6';
const OUTLINE_BUTTON_BG = '#ffffff';
const OUTLINE_BUTTON_BORDER = '#dadce0';

function getSummaryIndex(start: number, end: number, summaryAfter: boolean): number {
  return summaryAfter ? end + 1 : start - 1;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Focused render context for outline rendering functions.
 * Replaces the monolithic RenderContext with only the fields needed by outline rendering.
 */
export interface OutlineRenderContext {
  readonly viewport: ScrollViewport;
  readonly coords: CoordinateSystem;
  readonly currentSheetId: string;
  readonly showRowHeaders: boolean;
  readonly showColumnHeaders: boolean;
}

export interface OutlineRenderConfig {
  /** Grouping configuration for the sheet */
  groupingConfig: SheetGroupingConfig;
  /** Row groups for this sheet */
  rowGroups: GroupDefinition[];
  /** Column groups for this sheet */
  columnGroups: GroupDefinition[];
  /** Maximum row outline level (0 if no groups) */
  maxRowLevel: number;
  /** Maximum column outline level (0 if no groups) */
  maxColLevel: number;
  /** Row outline levels for visible rows */
  rowOutlineLevels: OutlineLevel[];
  /** Column outline levels for visible columns */
  columnOutlineLevels: OutlineLevel[];
}

export interface OutlineHitTestResult {
  type: 'level-button' | 'collapse-button' | 'none';
  axis: 'row' | 'column';
  /** For level-button: the level clicked (1-8). For collapse-button: undefined */
  level?: number;
  /** For collapse-button: the group ID */
  groupId?: string;
  /** For collapse-button: current collapsed state */
  collapsed?: boolean;
}

// =============================================================================
// Gutter Size Calculations
// =============================================================================

/**
 * Calculate the width of the row outline gutter based on max level.
 */
export function getRowOutlineGutterWidth(maxLevel: number): number {
  return maxLevel > 0 ? maxLevel * OUTLINE_LEVEL_WIDTH : 0;
}

/**
 * Calculate the height of the column outline gutter based on max level.
 */
export function getColumnOutlineGutterHeight(maxLevel: number): number {
  return maxLevel > 0 ? maxLevel * OUTLINE_LEVEL_HEIGHT : 0;
}

/**
 * Get the total row header width including outline gutter.
 *
 * @param maxRowLevel - Maximum row outline level
 * @param headerVisibility - Optional header visibility settings (defaults to both visible)
 */
export function getTotalRowHeaderWidth(
  maxRowLevel: number,
  headerVisibility?: HeaderVisibility,
): number {
  const { rowHeaderWidth } = getEffectiveHeaderDimensions(headerVisibility);
  return rowHeaderWidth + getRowOutlineGutterWidth(maxRowLevel);
}

/**
 * Get the total column header height including outline gutter.
 *
 * @param maxColLevel - Maximum column outline level
 * @param headerVisibility - Optional header visibility settings (defaults to both visible)
 */
export function getTotalColHeaderHeight(
  maxColLevel: number,
  headerVisibility?: HeaderVisibility,
): number {
  const { colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);
  return colHeaderHeight + getColumnOutlineGutterHeight(maxColLevel);
}

// =============================================================================
// Main Render Function
// =============================================================================

/**
 * Render outline symbols, level buttons, and collapse/expand buttons.
 *
 * @param ctx - Canvas 2D rendering context
 * @param renderContext - The render context containing viewport, coords, etc.
 * @param config - Outline render configuration (from GroupingDataSource)
 */
export function renderOutlines(
  ctx: CanvasRenderingContext2D,
  renderContext: OutlineRenderContext,
  config: OutlineRenderConfig,
): void {
  const { maxRowLevel, maxColLevel, groupingConfig } = config;
  const { viewport } = renderContext;

  // Skip if no grouping or outline symbols disabled
  if ((maxRowLevel === 0 && maxColLevel === 0) || !groupingConfig.showOutlineSymbols) {
    return;
  }

  // Only render gutter in primary viewport (avoid duplicates in split view)
  // TODO: Uncomment when viewportLayout is added to OutlineRenderContext
  // const { viewportLayout } = renderContext;
  // if (viewportLayout && viewport.id !== viewportLayout.primaryViewportId) {
  //   return;
  // }

  const canvasWidth = viewport.width;
  const canvasHeight = viewport.height;

  // Render row outline gutter (left side)
  if (maxRowLevel > 0) {
    renderRowOutlineGutter(ctx, renderContext, config, canvasHeight);
  }

  // Render column outline gutter (top)
  if (maxColLevel > 0) {
    renderColumnOutlineGutter(ctx, renderContext, config, canvasWidth);
  }

  // Render level buttons in corner if enabled
  if (groupingConfig.showOutlineLevelButtons) {
    renderLevelButtons(ctx, config, renderContext);
  }
}

// =============================================================================
// Row Outline Gutter
// =============================================================================

function renderRowOutlineGutter(
  ctx: CanvasRenderingContext2D,
  renderContext: OutlineRenderContext,
  config: OutlineRenderConfig,
  canvasHeight: number,
): void {
  const { coords } = renderContext;
  const { maxRowLevel, rowGroups, groupingConfig, rowOutlineLevels } = config;

  const visibleRegions = coords.getVisibleRegions(renderContext.currentSheetId);
  const mainRegion = visibleRegions.main;
  if (!mainRegion) return;

  const gutterWidth = getRowOutlineGutterWidth(maxRowLevel);
  const gutterX = 0; // Render at origin (before row headers)
  const headerHeight = getTotalColHeaderHeight(config.maxColLevel);

  // Draw gutter background
  ctx.fillStyle = DEFAULT_CHROME_THEME.headerBackground;
  ctx.fillRect(gutterX, headerHeight, gutterWidth, canvasHeight - headerHeight);

  // Draw right border
  ctx.strokeStyle = DEFAULT_CHROME_THEME.headerBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(gutterX + gutterWidth - 0.5, headerHeight);
  ctx.lineTo(gutterX + gutterWidth - 0.5, canvasHeight);
  ctx.stroke();

  // Build a map of row -> group for quick lookup
  const rowGroupMap = buildRowGroupMap(
    rowGroups,
    mainRegion.startRow,
    mainRegion.endRow,
    groupingConfig,
  );

  // Render outline bars and buttons for each visible row
  for (let row = mainRegion.startRow; row <= mainRegion.endRow; row++) {
    const cellRect = coords.cellToViewport(renderContext.currentSheetId, { row, col: 0 });
    if (!cellRect) continue;

    const y = cellRect.y;
    const rowHeight = cellRect.height;
    const outlineLevel = rowOutlineLevels.find((l) => l.index === row);

    if (outlineLevel && outlineLevel.level > 0) {
      // Draw level indicator bars
      renderRowLevelBars(ctx, gutterX, y, rowHeight, outlineLevel.level);
    }

    // Check if this row has a collapse/expand button
    const groupsEndingHere = rowGroupMap.get(row);
    if (groupsEndingHere) {
      for (const group of groupsEndingHere) {
        const buttonY = y + rowHeight / 2;
        const buttonX = gutterX + (group.level - 1) * OUTLINE_LEVEL_WIDTH + OUTLINE_LEVEL_WIDTH / 2;
        renderCollapseButton(ctx, buttonX, buttonY, group.collapsed);
      }
    }

    if (y + rowHeight > canvasHeight) break;
  }
}

// =============================================================================
// Column Outline Gutter
// =============================================================================

function renderColumnOutlineGutter(
  ctx: CanvasRenderingContext2D,
  renderContext: OutlineRenderContext,
  config: OutlineRenderConfig,
  canvasWidth: number,
): void {
  const { coords } = renderContext;
  const { maxColLevel, columnGroups, groupingConfig, columnOutlineLevels } = config;

  const visibleRegions = coords.getVisibleRegions(renderContext.currentSheetId);
  const mainRegion = visibleRegions.main;
  if (!mainRegion) return;

  const gutterHeight = getColumnOutlineGutterHeight(maxColLevel);
  const gutterY = 0; // Render at origin (above column headers)
  const headerWidth = getTotalRowHeaderWidth(config.maxRowLevel);

  // Draw gutter background
  ctx.fillStyle = DEFAULT_CHROME_THEME.headerBackground;
  ctx.fillRect(headerWidth, gutterY, canvasWidth - headerWidth, gutterHeight);

  // Draw bottom border
  ctx.strokeStyle = DEFAULT_CHROME_THEME.headerBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(headerWidth, gutterY + gutterHeight - 0.5);
  ctx.lineTo(canvasWidth, gutterY + gutterHeight - 0.5);
  ctx.stroke();

  // Build a map of col -> group for quick lookup
  const colGroupMap = buildColGroupMap(
    columnGroups,
    mainRegion.startCol,
    mainRegion.endCol,
    groupingConfig,
  );

  // Render outline bars and buttons for each visible column
  for (let col = mainRegion.startCol; col <= mainRegion.endCol; col++) {
    const cellRect = coords.cellToViewport(renderContext.currentSheetId, { row: 0, col });
    if (!cellRect) continue;

    const x = cellRect.x;
    const colWidth = cellRect.width;
    const outlineLevel = columnOutlineLevels.find((l) => l.index === col);

    if (outlineLevel && outlineLevel.level > 0) {
      // Draw level indicator bars
      renderColLevelBars(ctx, x, gutterY, colWidth, outlineLevel.level);
    }

    // Check if this column has a collapse/expand button
    const groupsEndingHere = colGroupMap.get(col);
    if (groupsEndingHere) {
      for (const group of groupsEndingHere) {
        const buttonX = x + colWidth / 2;
        const buttonY =
          gutterY + (group.level - 1) * OUTLINE_LEVEL_HEIGHT + OUTLINE_LEVEL_HEIGHT / 2;
        renderCollapseButton(ctx, buttonX, buttonY, group.collapsed);
      }
    }

    if (x + colWidth > canvasWidth) break;
  }
}

// =============================================================================
// Level Buttons (1, 2, 3, ...)
// =============================================================================

function renderLevelButtons(
  ctx: CanvasRenderingContext2D,
  config: OutlineRenderConfig,
  renderContext: OutlineRenderContext,
): void {
  const { maxRowLevel, maxColLevel } = config;

  // Get effective header dimensions based on visibility
  const headerVisibility = {
    showRowHeaders: renderContext.showRowHeaders,
    showColumnHeaders: renderContext.showColumnHeaders,
  };
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);

  ctx.font = `${OUTLINE_FONT_SIZE}px ${DEFAULT_CELL_STYLE.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Row level buttons (in the corner, stacked horizontally in row gutter)
  if (maxRowLevel > 0) {
    const colGutterHeight = getColumnOutlineGutterHeight(maxColLevel);

    for (let level = 1; level <= maxRowLevel + 1; level++) {
      const x = (level - 1) * OUTLINE_LEVEL_WIDTH + OUTLINE_LEVEL_WIDTH / 2;
      const y = colGutterHeight > 0 ? colGutterHeight / 2 : colHeaderHeight / 2;

      renderLevelButton(ctx, x, y, level);
    }
  }

  // Column level buttons (in the corner, stacked vertically in column gutter)
  if (maxColLevel > 0) {
    const rowGutterWidth = getRowOutlineGutterWidth(maxRowLevel);

    for (let level = 1; level <= maxColLevel + 1; level++) {
      const x = rowGutterWidth > 0 ? rowGutterWidth / 2 : rowHeaderWidth / 2;
      const y = (level - 1) * OUTLINE_LEVEL_HEIGHT + OUTLINE_LEVEL_HEIGHT / 2;

      renderLevelButton(ctx, x, y, level);
    }
  }
}

function renderLevelButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  level: number,
): void {
  const size = OUTLINE_BUTTON_SIZE;
  const halfSize = size / 2;

  // Draw button background
  ctx.fillStyle = OUTLINE_BUTTON_BG;
  ctx.strokeStyle = OUTLINE_BUTTON_BORDER;
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.roundRect(x - halfSize, y - halfSize, size, size, 2);
  ctx.fill();
  ctx.stroke();

  // Draw level number
  ctx.fillStyle = OUTLINE_TEXT_COLOR;
  ctx.fillText(String(level), x, y);
}

// =============================================================================
// Collapse/Expand Buttons (+/-)
// =============================================================================

function renderCollapseButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  collapsed: boolean,
): void {
  const size = OUTLINE_BUTTON_SIZE;
  const halfSize = size / 2;

  // Draw button background
  ctx.fillStyle = OUTLINE_BUTTON_BG;
  ctx.strokeStyle = OUTLINE_BUTTON_BORDER;
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.roundRect(x - halfSize, y - halfSize, size, size, 2);
  ctx.fill();
  ctx.stroke();

  // Draw +/- symbol
  ctx.strokeStyle = OUTLINE_TEXT_COLOR;
  ctx.lineWidth = 1.5;

  // Horizontal line (always present)
  ctx.beginPath();
  ctx.moveTo(x - 3, y);
  ctx.lineTo(x + 3, y);
  ctx.stroke();

  // Vertical line (only for collapsed - shows +)
  if (collapsed) {
    ctx.beginPath();
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x, y + 3);
    ctx.stroke();
  }
}

// =============================================================================
// Level Bars
// =============================================================================

function renderRowLevelBars(
  ctx: CanvasRenderingContext2D,
  gutterX: number,
  rowY: number,
  rowHeight: number,
  level: number,
): void {
  ctx.strokeStyle = OUTLINE_BAR_COLOR;
  ctx.lineWidth = 1;

  // Draw vertical bars for each level this row belongs to
  for (let l = 1; l <= level; l++) {
    const barX = gutterX + (l - 0.5) * OUTLINE_LEVEL_WIDTH;

    ctx.beginPath();
    ctx.moveTo(barX, rowY);
    ctx.lineTo(barX, rowY + rowHeight);
    ctx.stroke();
  }
}

function renderColLevelBars(
  ctx: CanvasRenderingContext2D,
  colX: number,
  gutterY: number,
  colWidth: number,
  level: number,
): void {
  ctx.strokeStyle = OUTLINE_BAR_COLOR;
  ctx.lineWidth = 1;

  // Draw horizontal bars for each level this column belongs to
  for (let l = 1; l <= level; l++) {
    const barY = gutterY + (l - 0.5) * OUTLINE_LEVEL_HEIGHT;

    ctx.beginPath();
    ctx.moveTo(colX, barY);
    ctx.lineTo(colX + colWidth, barY);
    ctx.stroke();
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build a map of row index -> groups that have buttons at that row.
 */
function buildRowGroupMap(
  groups: GroupDefinition[],
  startRow: number,
  endRow: number,
  config: SheetGroupingConfig,
): Map<number, GroupDefinition[]> {
  const map = new Map<number, GroupDefinition[]>();

  for (const group of groups) {
    // The button appears at the adjacent summary row position.
    const buttonRow = getSummaryIndex(group.start, group.end, config.summaryRowsBelow);

    if (buttonRow >= startRow && buttonRow <= endRow) {
      if (!map.has(buttonRow)) {
        map.set(buttonRow, []);
      }
      map.get(buttonRow)!.push(group);
    }
  }

  return map;
}

/**
 * Build a map of column index -> groups that have buttons at that column.
 */
function buildColGroupMap(
  groups: GroupDefinition[],
  startCol: number,
  endCol: number,
  config: SheetGroupingConfig,
): Map<number, GroupDefinition[]> {
  const map = new Map<number, GroupDefinition[]>();

  for (const group of groups) {
    const buttonCol = getSummaryIndex(group.start, group.end, config.summaryColumnsRight);

    if (buttonCol >= startCol && buttonCol <= endCol) {
      if (!map.has(buttonCol)) {
        map.set(buttonCol, []);
      }
      map.get(buttonCol)!.push(group);
    }
  }

  return map;
}

// =============================================================================
// Hit Testing
// =============================================================================

/**
 * Test if a point hits an outline control.
 *
 * @param x - X coordinate in viewport pixels
 * @param y - Y coordinate in viewport pixels
 * @param config - Outline render configuration
 * @param renderContext - The render context
 */
export function hitTestOutline(
  x: number,
  y: number,
  config: OutlineRenderConfig,
  renderContext: OutlineRenderContext,
): OutlineHitTestResult {
  const { maxRowLevel, maxColLevel, groupingConfig } = config;

  // Early exit if no outlines
  if (maxRowLevel === 0 && maxColLevel === 0) {
    return { type: 'none', axis: 'row' };
  }

  // Get effective header dimensions based on visibility
  const headerVisibility = {
    showRowHeaders: renderContext.showRowHeaders,
    showColumnHeaders: renderContext.showColumnHeaders,
  };
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);

  const rowGutterWidth = getRowOutlineGutterWidth(maxRowLevel);
  const colGutterHeight = getColumnOutlineGutterHeight(maxColLevel);
  const headerWidth = getTotalRowHeaderWidth(maxRowLevel, headerVisibility);
  const headerHeight = getTotalColHeaderHeight(maxColLevel, headerVisibility);

  // Check row level buttons (in corner area)
  if (groupingConfig.showOutlineLevelButtons && maxRowLevel > 0) {
    const buttonY = colGutterHeight > 0 ? colGutterHeight / 2 : colHeaderHeight / 2;

    for (let level = 1; level <= maxRowLevel + 1; level++) {
      const buttonX = (level - 1) * OUTLINE_LEVEL_WIDTH + OUTLINE_LEVEL_WIDTH / 2;

      if (isPointInButton(x, y, buttonX, buttonY)) {
        return { type: 'level-button', axis: 'row', level };
      }
    }
  }

  // Check column level buttons (in corner area)
  if (groupingConfig.showOutlineLevelButtons && maxColLevel > 0) {
    const buttonX = rowGutterWidth > 0 ? rowGutterWidth / 2 : rowHeaderWidth / 2;

    for (let level = 1; level <= maxColLevel + 1; level++) {
      const buttonY = (level - 1) * OUTLINE_LEVEL_HEIGHT + OUTLINE_LEVEL_HEIGHT / 2;

      if (isPointInButton(x, y, buttonX, buttonY)) {
        return { type: 'level-button', axis: 'column', level };
      }
    }
  }

  // Check row collapse buttons (in row gutter)
  if (maxRowLevel > 0 && x >= 0 && x < rowGutterWidth && y >= headerHeight) {
    const result = hitTestRowCollapseButtons(x, y, config, renderContext);
    if (result.type !== 'none') return result;
  }

  // Check column collapse buttons (in column gutter)
  if (maxColLevel > 0 && y >= 0 && y < colGutterHeight && x >= headerWidth) {
    const result = hitTestColumnCollapseButtons(x, y, config, renderContext);
    if (result.type !== 'none') return result;
  }

  return { type: 'none', axis: 'row' };
}

function hitTestRowCollapseButtons(
  x: number,
  y: number,
  config: OutlineRenderConfig,
  renderContext: OutlineRenderContext,
): OutlineHitTestResult {
  const { rowGroups, groupingConfig } = config;
  const { coords } = renderContext;

  const visibleRegions = coords.getVisibleRegions(renderContext.currentSheetId);
  const mainRegion = visibleRegions.main;
  if (!mainRegion) return { type: 'none', axis: 'row' };

  for (let row = mainRegion.startRow; row <= mainRegion.endRow; row++) {
    const cellRect = coords.cellToViewport(renderContext.currentSheetId, { row, col: 0 });
    if (!cellRect) continue;

    const rowY = cellRect.y;
    const rowHeight = cellRect.height;

    // Check if any group has a button at this row
    for (const group of rowGroups) {
      const buttonRow = getSummaryIndex(group.start, group.end, groupingConfig.summaryRowsBelow);

      if (buttonRow === row) {
        const buttonX = (group.level - 1) * OUTLINE_LEVEL_WIDTH + OUTLINE_LEVEL_WIDTH / 2;
        const buttonY = rowY + rowHeight / 2;

        if (isPointInButton(x, y, buttonX, buttonY)) {
          return {
            type: 'collapse-button',
            axis: 'row',
            groupId: group.id,
            collapsed: group.collapsed,
          };
        }
      }
    }

    if (rowY > y + OUTLINE_BUTTON_SIZE) break;
  }

  return { type: 'none', axis: 'row' };
}

function hitTestColumnCollapseButtons(
  x: number,
  y: number,
  config: OutlineRenderConfig,
  renderContext: OutlineRenderContext,
): OutlineHitTestResult {
  const { columnGroups, groupingConfig } = config;
  const { coords } = renderContext;

  const visibleRegions = coords.getVisibleRegions(renderContext.currentSheetId);
  const mainRegion = visibleRegions.main;
  if (!mainRegion) return { type: 'none', axis: 'column' };

  for (let col = mainRegion.startCol; col <= mainRegion.endCol; col++) {
    const cellRect = coords.cellToViewport(renderContext.currentSheetId, { row: 0, col });
    if (!cellRect) continue;

    const colX = cellRect.x;
    const colWidth = cellRect.width;

    // Check if any group has a button at this column
    for (const group of columnGroups) {
      const buttonCol = getSummaryIndex(group.start, group.end, groupingConfig.summaryColumnsRight);

      if (buttonCol === col) {
        const buttonX = colX + colWidth / 2;
        const buttonY = (group.level - 1) * OUTLINE_LEVEL_HEIGHT + OUTLINE_LEVEL_HEIGHT / 2;

        if (isPointInButton(x, y, buttonX, buttonY)) {
          return {
            type: 'collapse-button',
            axis: 'column',
            groupId: group.id,
            collapsed: group.collapsed,
          };
        }
      }
    }

    if (colX > x + OUTLINE_BUTTON_SIZE) break;
  }

  return { type: 'none', axis: 'column' };
}

function isPointInButton(px: number, py: number, bx: number, by: number): boolean {
  const halfSize = OUTLINE_BUTTON_SIZE / 2 + 2; // Small margin for easier clicking
  return Math.abs(px - bx) <= halfSize && Math.abs(py - by) <= halfSize;
}

// =============================================================================
// Helper to build config from GroupingDataSource
// =============================================================================

/**
 * Build OutlineRenderConfig from a GroupingDataSource and CoordinateSystem.
 * This is a convenience function to extract grouping data for outline rendering.
 */
export function buildOutlineConfig(
  groupingData: GroupingDataSource,
  coords: CoordinateSystem,
  currentSheetId: string,
): OutlineRenderConfig | null {
  const groupingConfig = groupingData.getGroupingConfig();

  // No grouping = no outlines to render
  if (!groupingConfig) {
    return null;
  }

  const rowGroups = groupingData.getRowGroups();
  const columnGroups = groupingData.getColumnGroups();
  const maxRowLevel = groupingData.maxRowOutlineLevel;
  const maxColLevel = groupingData.maxColOutlineLevel;

  // Get visible range for outline levels
  const visibleRegions = coords.getVisibleRegions(currentSheetId);
  const mainRegion = visibleRegions.main;

  const rowOutlineLevels = mainRegion
    ? groupingData.getRowOutlineLevels(mainRegion.startRow, mainRegion.endRow)
    : [];
  const columnOutlineLevels = mainRegion
    ? groupingData.getColumnOutlineLevels(mainRegion.startCol, mainRegion.endCol)
    : [];

  return {
    groupingConfig,
    rowGroups: [...rowGroups],
    columnGroups: [...columnGroups],
    maxRowLevel,
    maxColLevel,
    rowOutlineLevels: [...rowOutlineLevels],
    columnOutlineLevels: [...columnOutlineLevels],
  };
}

// =============================================================================
// Grouping Data Type (re-exported from contracts)
// =============================================================================

/**
 * Re-export GroupingData from contracts.
 * @see @mog-sdk/contracts/rendering/grouping
 */
export type { GroupingData } from '@mog-sdk/contracts/rendering';

// =============================================================================
// OutlineHitTester Class (implements HitTestService)
// =============================================================================

/**
 * OutlineHitTester implements the HitTestService interface.
 *
 * This class enables decoupling of state coordinator from canvas implementation.
 * The coordinator injects this service at construction time rather than
 * importing the hitTestOutline function directly.
 *
 * Architecture Note:
 * - This is a stateless service, NOT a Bridge
 * - Unlike Calculator/Pivot bridges, it has no EventBus triggers or lifecycle
 * - The coordinator owns the instance and provides dependency getters
 *
 * @see contracts/src/rendering/hit-test-service.ts for interface definition
 */
export class OutlineHitTester implements HitTestService {
  constructor(
    private readonly getCoordinateSystem: () => CoordinateSystem | null,
    private readonly getGroupingData: () => GroupingData | null,
  ) {}

  /**
   * Hit test against outline buttons (row/column grouping controls).
   *
   * This method builds a minimal render context with only the fields
   * needed by the hit test logic (coords), then delegates to the
   * existing hitTestOutline function.
   *
   * @param x - X coordinate in viewport pixels
   * @param y - Y coordinate in viewport pixels
   * @returns Information about which button was clicked, or null if no hit
   */
  hitTestOutline(x: number, y: number): ContractOutlineHitTestResult | null {
    const coords = this.getCoordinateSystem();
    const groupingData = this.getGroupingData();

    if (!coords || !groupingData || !groupingData.config) {
      return null;
    }

    const { config, rowGroups, columnGroups, maxRowLevel, maxColLevel } = groupingData;

    // Early exit if no groups
    if (maxRowLevel === 0 && maxColLevel === 0) {
      return null;
    }

    // Build outline config for hit testing
    const outlineConfig: OutlineRenderConfig = {
      groupingConfig: config,
      rowGroups,
      columnGroups,
      maxRowLevel,
      maxColLevel,
      rowOutlineLevels: [], // Not needed for hit testing
      columnOutlineLevels: [], // Not needed for hit testing
    };

    // Build a focused render context for hit testing
    // hitTestOutline uses coords for viewport/position calculations AND
    // header visibility for correct hit test bounds
    const headerVisibility = coords.getHeaderVisibility();
    const renderContext: OutlineRenderContext = {
      coords,
      viewport: coords.getViewport(),
      currentSheetId: '', // CoordinateSystem tracks the active sheet internally
      showRowHeaders: headerVisibility.showRowHeaders ?? true,
      showColumnHeaders: headerVisibility.showColumnHeaders ?? true,
    };

    // Call the existing hit test function
    const result = hitTestOutline(x, y, outlineConfig, renderContext);
    return result.type !== 'none' ? result : null;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an OutlineHitTester instance.
 *
 * @param getCoordinateSystem - Getter for the current coordinate system
 * @param getGroupingData - Getter for the current grouping data
 * @returns A new OutlineHitTester instance
 */
export function createOutlineHitTester(
  getCoordinateSystem: () => CoordinateSystem | null,
  getGroupingData: () => GroupingData | null,
): OutlineHitTester {
  return new OutlineHitTester(getCoordinateSystem, getGroupingData);
}
