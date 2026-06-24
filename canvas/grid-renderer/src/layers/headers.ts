/**
 * Headers Layer
 *
 * Renders column labels (A, B, C...), row numbers (1, 2, 3...), corner "select all"
 * button, and outline gutter (grouping controls: level buttons, +/- collapse/expand
 * buttons, connecting bars).
 *
 * renderMode: 'once' means NO clip/translate/scale from engine. This layer draws
 * at canvas-absolute CSS pixel coordinates. Headers need knowledge of regions
 * (frozen row headers at different y-positions than scrolling rows).
 *
 * renderMode: 'once' | canvas: 0 | z-index: 800
 *
 * @module grid-renderer/layers/headers
 */

import type { FrameContext, RenderRegion } from '@mog/canvas-engine';
import { docToCanvasXY, snapToPixelGrid } from '@mog/canvas-engine';
import type {
  GridRegionMeta,
  GroupingDataSource,
  SelectionDataSource,
  SheetDataSource,
} from '@mog-sdk/contracts/rendering';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { snapDocXToPixelGrid, snapDocYToPixelGrid } from '../shared/cell-bounds';
import {
  COL_HEADER_HEIGHT,
  OUTLINE_BUTTON_SIZE,
  OUTLINE_LEVEL_HEIGHT,
  OUTLINE_LEVEL_WIDTH,
  ROW_HEADER_WIDTH,
} from '../shared/constants';
import { BaseLayer, type OnceLayerWithChrome } from './base-layer';

// =============================================================================
// Constants
// =============================================================================

const HEADER_FONT = '11px Calibri, sans-serif';
const HIDDEN_INDICATOR_COLOR = '#217346';
const HIDDEN_INDICATOR_SIZE = 4;
const OUTLINE_TEXT_COLOR = '#5f6368';
const OUTLINE_FONT_SIZE = 9;
const OUTLINE_BAR_COLOR = '#9aa0a6';
const OUTLINE_BUTTON_BG = '#ffffff';
const OUTLINE_BUTTON_BORDER = '#dadce0';

function getSummaryIndex(start: number, end: number, summaryAfter: boolean): number {
  return summaryAfter ? end + 1 : start - 1;
}

// =============================================================================
// Configuration
// =============================================================================

export interface HeadersLayerConfig {
  /** Font for header labels */
  font?: string;
  /** Text color for header labels */
  textColor?: string;
  /** Background color for headers */
  bgColor?: string;
  /** Border color for header grid lines */
  borderColor?: string;
  /** Highlight background for selected column/row headers */
  highlightBgColor?: string;
  /** Highlight text color for selected column/row headers */
  highlightTextColor?: string;
}

function defaultConfigFromSheet(sheet: SheetDataSource): Required<HeadersLayerConfig> {
  const theme = sheet.chromeTheme;
  const skin = sheet.sheetViewSkin.skinId === 'default' ? null : sheet.sheetViewSkin.headers;
  return {
    font:
      skin && (skin.fontSizePx || skin.fontFamily || skin.fontWeight)
        ? `${skin.fontWeight ?? 600} ${skin.fontSizePx ?? 12}px ${skin.fontFamily ?? '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'}`
        : HEADER_FONT,
    textColor: skin?.textColor ?? theme.headerText,
    bgColor: skin?.background ?? theme.headerBackground,
    borderColor: skin?.borderColor ?? theme.headerBorder,
    highlightBgColor: skin?.selectedBackground ?? theme.headerHighlightBackground,
    highlightTextColor: skin?.selectedTextColor ?? theme.headerHighlightText,
  };
}

// =============================================================================
// Column Label Utility
// =============================================================================

/**
 * Convert a zero-based column index to a column label (A, B, ..., Z, AA, AB, ...).
 */
function columnLabel(col: number): string {
  let label = '';
  let c = col;
  while (c >= 0) {
    label = String.fromCharCode(65 + (c % 26)) + label;
    c = Math.floor(c / 26) - 1;
  }
  return label;
}

// =============================================================================
// Headers Layer
// =============================================================================

export class HeadersLayer extends BaseLayer implements OnceLayerWithChrome {
  private sheet: SheetDataSource;
  private positionIndex: ViewportPositionIndex;
  private selection: SelectionDataSource;
  private grouping: GroupingDataSource;
  private config: Required<HeadersLayerConfig>;
  private readonly configOverrides: HeadersLayerConfig;

  /**
   * Region layout is provided externally by the coordinator so this "once" layer
   * knows where the frozen/scrolling regions are on the canvas.
   */
  private regions: ReadonlyArray<RenderRegion<GridRegionMeta>> = [];

  constructor(
    sheet: SheetDataSource,
    positionIndex: ViewportPositionIndex,
    selection: SelectionDataSource,
    grouping: GroupingDataSource,
    config: HeadersLayerConfig = {},
  ) {
    super({
      id: 'headers',
      zIndex: 800,
      renderMode: 'once',
      canvas: 0,
    });
    this.sheet = sheet;
    this.positionIndex = positionIndex;
    this.selection = selection;
    this.grouping = grouping;
    this.configOverrides = config;
    this.config = { ...defaultConfigFromSheet(sheet), ...this.configOverrides };
  }

  // ===========================================================================
  // Data Source Updates
  // ===========================================================================

  setSheet(sheet: SheetDataSource): void {
    this.sheet = sheet;
    // Refresh theme-derived defaults while preserving explicit overrides
    this.config = { ...defaultConfigFromSheet(sheet), ...this.configOverrides };
    this.markDirty();
  }

  setPositionIndex(positionIndex: ViewportPositionIndex): void {
    this.positionIndex = positionIndex;
    this.markDirty();
  }

  setSelection(selection: SelectionDataSource): void {
    this.selection = selection;
    this.markDirty();
  }

  setGrouping(grouping: GroupingDataSource): void {
    this.grouping = grouping;
    this.markDirty();
  }

  /**
   * Set the region layout so headers can align with frozen/scrolling regions.
   */
  setRegions(regions: ReadonlyArray<RenderRegion<GridRegionMeta>>): void {
    this.regions = regions;
    this.markDirty();
  }

  // ===========================================================================
  // Render
  // ===========================================================================

  render(ctx: CanvasRenderingContext2D, _region: RenderRegion, frame: FrameContext): void {
    const sheetId = this.sheet.sheetId;
    const showRowHeaders = this.sheet.showRowHeaders;
    const showColumnHeaders = this.sheet.showColumnHeaders;

    if (!showRowHeaders && !showColumnHeaders) return;

    const canvasWidth = frame.canvasSize.width;
    const canvasHeight = frame.canvasSize.height;

    // Compute outline gutter sizes
    const maxRowLevel = this.grouping.maxRowOutlineLevel;
    const maxColLevel = this.grouping.maxColOutlineLevel;
    const rowGutterWidth = maxRowLevel > 0 ? maxRowLevel * OUTLINE_LEVEL_WIDTH : 0;
    const colGutterHeight = maxColLevel > 0 ? maxColLevel * OUTLINE_LEVEL_HEIGHT : 0;

    // Effective header dimensions
    const effectiveRowHeaderWidth = showRowHeaders ? ROW_HEADER_WIDTH : 0;
    const effectiveColHeaderHeight = showColumnHeaders ? COL_HEADER_HEIGHT : 0;
    const totalRowHeaderWidth = effectiveRowHeaderWidth + rowGutterWidth;
    const totalColHeaderHeight = effectiveColHeaderHeight + colGutterHeight;

    // Selection-membership predicates. Closures over the live ranges array
    // — O(ranges) per check, no O(MAX_ROW) Set materialization. Selecting a
    // full column installs `endRow = MAX_ROW - 1`, so the prior Set-fill
    // ran ~1M iterations on every header re-render.
    const selRanges = this.selection.getSelectionState().ranges ?? [];
    const isRowSelected = (row: number): boolean => {
      for (const r of selRanges) if (row >= r.startRow && row <= r.endRow) return true;
      return false;
    };
    const isColSelected = (col: number): boolean => {
      for (const r of selRanges) if (col >= r.startCol && col <= r.endCol) return true;
      return false;
    };

    const dpr = frame.dpr;

    // Render column headers
    if (showColumnHeaders) {
      this.renderColumnHeaders(
        ctx,
        sheetId,
        canvasWidth,
        totalRowHeaderWidth,
        colGutterHeight,
        isColSelected,
        dpr,
      );
    }

    // Render row headers
    if (showRowHeaders) {
      this.renderRowHeaders(
        ctx,
        sheetId,
        canvasHeight,
        rowGutterWidth,
        totalColHeaderHeight,
        isRowSelected,
        dpr,
      );
    }

    // Render corner cell
    if (showRowHeaders && showColumnHeaders) {
      this.renderCorner(ctx, totalRowHeaderWidth, totalColHeaderHeight, dpr);
    }

    // Render outline gutter
    if (maxRowLevel > 0 || maxColLevel > 0) {
      this.renderOutlineGutter(
        ctx,
        sheetId,
        canvasWidth,
        canvasHeight,
        rowGutterWidth,
        colGutterHeight,
        totalRowHeaderWidth,
        totalColHeaderHeight,
        maxRowLevel,
        maxColLevel,
        dpr,
      );
    }
  }

  // ===========================================================================
  // Column Headers
  // ===========================================================================

  private renderColumnHeaders(
    ctx: CanvasRenderingContext2D,
    sheetId: string,
    canvasWidth: number,
    totalRowHeaderWidth: number,
    colGutterHeight: number,
    isColSelected: (col: number) => boolean,
    dpr: number,
  ): void {
    const headerY = colGutterHeight;
    const headerHeight = COL_HEADER_HEIGHT;

    // Background
    ctx.fillStyle = this.config.bgColor;
    ctx.fillRect(totalRowHeaderWidth, headerY, canvasWidth - totalRowHeaderWidth, headerHeight);

    // Bottom border
    ctx.strokeStyle = this.config.borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const bottomBorderY = snapToPixelGrid(headerY + headerHeight, dpr);
    ctx.moveTo(totalRowHeaderWidth, bottomBorderY);
    ctx.lineTo(canvasWidth, bottomBorderY);
    ctx.stroke();

    ctx.font = this.config.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Iterate over regions to draw column headers at correct positions.
    // Per-region paint is wrapped in `withRegionBandClip` so partial-col
    // labels at the freeze boundary cannot bleed into the adjacent region's
    // column-header band. Global col-header chrome (background + bottom
    // border above) stays outside the clip.
    for (const reg of this.regions) {
      const meta = reg.metadata as GridRegionMeta;
      if (meta.sheetId !== sheetId) continue;

      const { startCol, endCol } = meta.cellRange;

      this.withRegionBandClip(
        ctx,
        { x: reg.bounds.x, y: headerY, width: reg.bounds.width, height: headerHeight },
        dpr,
        () => {
          for (let col = startCol; col <= endCol; col++) {
            const docX = this.positionIndex.getColLeft(col);
            const colWidth = this.positionIndex.getColWidth(col);

            // Position relative to region (canvas-absolute; this layer is renderMode: 'once')
            const x = docToCanvasXY(docX, 0, reg).x;
            const w = colWidth * reg.zoom;

            // Skip if outside canvas
            if (x + w < totalRowHeaderWidth || x > canvasWidth) continue;

            // Clip to header area
            const clippedX = Math.max(totalRowHeaderWidth, x);
            const clippedW = Math.min(x + w, canvasWidth) - clippedX;
            if (clippedW <= 0) continue;

            const isSelected = isColSelected(col);
            const isHidden = this.positionIndex.isColHidden(col);

            // Highlight background for selected columns
            if (isSelected) {
              ctx.fillStyle = this.config.highlightBgColor;
              ctx.fillRect(clippedX, headerY, clippedW, headerHeight);
            }

            // Column label text
            if (!isHidden) {
              ctx.fillStyle = isSelected ? this.config.highlightTextColor : this.config.textColor;
              ctx.fillText(columnLabel(col), x + w / 2, headerY + headerHeight / 2);
            }

            // Right border — snap region-local coordinate, then transform to canvas-absolute
            const snappedLocalX = snapDocXToPixelGrid(reg, docX + colWidth, dpr);
            const borderX = reg.bounds.x + snappedLocalX * reg.zoom;
            ctx.strokeStyle = this.config.borderColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(borderX, headerY);
            ctx.lineTo(borderX, headerY + headerHeight);
            ctx.stroke();

            // Hidden column indicator (blue triangle at boundary)
            if (col > 0 && this.positionIndex.isColHidden(col - 1)) {
              this.drawHiddenIndicator(ctx, x, headerY + headerHeight / 2, 'left');
            }
          }
        },
      );
    }
  }

  // ===========================================================================
  // Row Headers
  // ===========================================================================

  private renderRowHeaders(
    ctx: CanvasRenderingContext2D,
    sheetId: string,
    canvasHeight: number,
    rowGutterWidth: number,
    totalColHeaderHeight: number,
    isRowSelected: (row: number) => boolean,
    dpr: number,
  ): void {
    const headerX = rowGutterWidth;
    const headerWidth = ROW_HEADER_WIDTH;

    // Background
    ctx.fillStyle = this.config.bgColor;
    ctx.fillRect(headerX, totalColHeaderHeight, headerWidth, canvasHeight - totalColHeaderHeight);

    // Right border
    ctx.strokeStyle = this.config.borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const rightBorderX = snapToPixelGrid(headerX + headerWidth, dpr);
    ctx.moveTo(rightBorderX, totalColHeaderHeight);
    ctx.lineTo(rightBorderX, canvasHeight);
    ctx.stroke();

    ctx.font = this.config.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Iterate over regions to draw row headers at correct positions.
    // Per-region paint is wrapped in `withRegionBandClip` so partial-row
    // labels at the freeze boundary cannot bleed into the adjacent region's
    // row-header band (the user-reported freeze-divider bleed). Global
    // row-header chrome (background + right border above) stays outside.
    for (const reg of this.regions) {
      const meta = reg.metadata as GridRegionMeta;
      if (meta.sheetId !== sheetId) continue;

      const { startRow, endRow } = meta.cellRange;

      this.withRegionBandClip(
        ctx,
        { x: headerX, y: reg.bounds.y, width: headerWidth, height: reg.bounds.height },
        dpr,
        () => {
          for (let row = startRow; row <= endRow; row++) {
            const docY = this.positionIndex.getRowTop(row);
            const rowHeight = this.positionIndex.getRowHeight(row);

            const y = docToCanvasXY(0, docY, reg).y;
            const h = rowHeight * reg.zoom;

            if (y + h < totalColHeaderHeight || y > canvasHeight) continue;

            const clippedY = Math.max(totalColHeaderHeight, y);
            const clippedH = Math.min(y + h, canvasHeight) - clippedY;
            if (clippedH <= 0) continue;

            const isSelected = isRowSelected(row);
            const isHidden = this.positionIndex.isRowHidden(row);

            // Highlight background for selected rows
            if (isSelected) {
              ctx.fillStyle = this.config.highlightBgColor;
              ctx.fillRect(headerX, clippedY, headerWidth, clippedH);
            }

            // Row number text (1-based)
            if (!isHidden) {
              ctx.fillStyle = isSelected ? this.config.highlightTextColor : this.config.textColor;
              ctx.fillText(String(row + 1), headerX + headerWidth / 2, y + h / 2);
            }

            // Bottom border — snap region-local coordinate, then transform to canvas-absolute
            const snappedLocalY = snapDocYToPixelGrid(reg, docY + rowHeight, dpr);
            const borderY = reg.bounds.y + snappedLocalY * reg.zoom;
            ctx.strokeStyle = this.config.borderColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(headerX, borderY);
            ctx.lineTo(headerX + headerWidth, borderY);
            ctx.stroke();

            // Hidden row indicator (blue triangle at boundary)
            if (row > 0 && this.positionIndex.isRowHidden(row - 1)) {
              this.drawHiddenIndicator(ctx, headerX + headerWidth / 2, y, 'top');
            }
          }
        },
      );
    }
  }

  // ===========================================================================
  // Corner Cell (Select All)
  // ===========================================================================

  private renderCorner(
    ctx: CanvasRenderingContext2D,
    totalRowHeaderWidth: number,
    totalColHeaderHeight: number,
    dpr: number,
  ): void {
    ctx.fillStyle = this.config.bgColor;
    ctx.fillRect(0, 0, totalRowHeaderWidth, totalColHeaderHeight);

    // Right border
    const cornerRightX = snapToPixelGrid(totalRowHeaderWidth, dpr);
    ctx.strokeStyle = this.config.borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cornerRightX, 0);
    ctx.lineTo(cornerRightX, totalColHeaderHeight);
    ctx.stroke();

    // Bottom border
    const cornerBottomY = snapToPixelGrid(totalColHeaderHeight, dpr);
    ctx.beginPath();
    ctx.moveTo(0, cornerBottomY);
    ctx.lineTo(totalRowHeaderWidth, cornerBottomY);
    ctx.stroke();

    // Excel-style select-all corner mark: a right triangle scaled to the
    // rectangular header corner rather than a square icon.
    const inset = 5;
    ctx.fillStyle = this.config.highlightBgColor;
    ctx.beginPath();
    ctx.moveTo(inset, totalColHeaderHeight - inset);
    ctx.lineTo(totalRowHeaderWidth - inset, totalColHeaderHeight - inset);
    ctx.lineTo(totalRowHeaderWidth - inset, inset);
    ctx.closePath();
    ctx.fill();
  }

  // ===========================================================================
  // Hidden Row/Col Indicators
  // ===========================================================================

  private drawHiddenIndicator(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    direction: 'left' | 'top',
  ): void {
    ctx.save();
    ctx.fillStyle = HIDDEN_INDICATOR_COLOR;
    ctx.beginPath();

    const s = HIDDEN_INDICATOR_SIZE;
    if (direction === 'left') {
      // Small blue triangle pointing left at boundary
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
    } else {
      // Small blue triangle pointing up at boundary
      ctx.moveTo(x - s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x + s, y);
    }

    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ===========================================================================
  // Outline Gutter
  // ===========================================================================

  private renderOutlineGutter(
    ctx: CanvasRenderingContext2D,
    sheetId: string,
    canvasWidth: number,
    canvasHeight: number,
    rowGutterWidth: number,
    colGutterHeight: number,
    totalRowHeaderWidth: number,
    totalColHeaderHeight: number,
    maxRowLevel: number,
    maxColLevel: number,
    dpr: number,
  ): void {
    const groupingConfig = this.grouping.getGroupingConfig();
    if (!groupingConfig) return;

    // Row outline gutter (left side, below column headers)
    if (maxRowLevel > 0) {
      // Gutter background
      ctx.fillStyle = this.config.bgColor;
      ctx.fillRect(0, totalColHeaderHeight, rowGutterWidth, canvasHeight - totalColHeaderHeight);

      // Right border
      ctx.strokeStyle = this.config.borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const gutterRightX = snapToPixelGrid(rowGutterWidth, dpr);
      ctx.moveTo(gutterRightX, totalColHeaderHeight);
      ctx.lineTo(gutterRightX, canvasHeight);
      ctx.stroke();

      // Row group bars and collapse buttons. Per-region paint is wrapped in
      // `withRegionBandClip` so partial-row collapse buttons at the freeze
      // boundary cannot bleed into the adjacent region's row-outline band.
      const rowGroups = this.grouping.getRowGroups();
      for (const reg of this.regions) {
        const meta = reg.metadata as GridRegionMeta;
        if (meta.sheetId !== sheetId) continue;

        const { startRow, endRow } = meta.cellRange;
        const levels = this.grouping.getRowOutlineLevels(startRow, endRow);

        this.withRegionBandClip(
          ctx,
          { x: 0, y: reg.bounds.y, width: rowGutterWidth, height: reg.bounds.height },
          dpr,
          () => {
            for (let row = startRow; row <= endRow; row++) {
              const docY = this.positionIndex.getRowTop(row);
              const rowH = this.positionIndex.getRowHeight(row);
              const y = docToCanvasXY(0, docY, reg).y;
              const h = rowH * reg.zoom;

              if (y + h < totalColHeaderHeight || y > canvasHeight) continue;

              const outlineLevel = levels.find((l) => l.index === row);
              if (outlineLevel && outlineLevel.level > 0) {
                this.renderRowLevelBars(ctx, 0, y, h, outlineLevel.level);
              }

              // Collapse buttons at adjacent summary rows
              for (const group of rowGroups) {
                const buttonRow = getSummaryIndex(
                  group.start,
                  group.end,
                  groupingConfig.summaryRowsBelow,
                );
                if (buttonRow === row) {
                  const buttonX = (group.level - 1) * OUTLINE_LEVEL_WIDTH + OUTLINE_LEVEL_WIDTH / 2;
                  const buttonY = y + h / 2;
                  this.renderCollapseButton(ctx, buttonX, buttonY, group.collapsed);
                }
              }
            }
          },
        );
      }
    }

    // Column outline gutter (top, right of row headers)
    if (maxColLevel > 0) {
      // Gutter background
      ctx.fillStyle = this.config.bgColor;
      ctx.fillRect(totalRowHeaderWidth, 0, canvasWidth - totalRowHeaderWidth, colGutterHeight);

      // Bottom border
      ctx.strokeStyle = this.config.borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const gutterBottomY = snapToPixelGrid(colGutterHeight, dpr);
      ctx.moveTo(totalRowHeaderWidth, gutterBottomY);
      ctx.lineTo(canvasWidth, gutterBottomY);
      ctx.stroke();

      // Column group bars and collapse buttons. Per-region paint is wrapped
      // in `withRegionBandClip` so partial-col collapse buttons at the
      // freeze boundary cannot bleed into the adjacent region's
      // col-outline band.
      const colGroups = this.grouping.getColumnGroups();
      for (const reg of this.regions) {
        const meta = reg.metadata as GridRegionMeta;
        if (meta.sheetId !== sheetId) continue;

        const { startCol, endCol } = meta.cellRange;
        const levels = this.grouping.getColumnOutlineLevels(startCol, endCol);

        this.withRegionBandClip(
          ctx,
          { x: reg.bounds.x, y: 0, width: reg.bounds.width, height: colGutterHeight },
          dpr,
          () => {
            for (let col = startCol; col <= endCol; col++) {
              const docX = this.positionIndex.getColLeft(col);
              const colW = this.positionIndex.getColWidth(col);
              const x = docToCanvasXY(docX, 0, reg).x;
              const w = colW * reg.zoom;

              if (x + w < totalRowHeaderWidth || x > canvasWidth) continue;

              const outlineLevel = levels.find((l) => l.index === col);
              if (outlineLevel && outlineLevel.level > 0) {
                this.renderColLevelBars(ctx, x, 0, w, outlineLevel.level);
              }

              // Collapse buttons at adjacent summary columns
              for (const group of colGroups) {
                const buttonCol = getSummaryIndex(
                  group.start,
                  group.end,
                  groupingConfig.summaryColumnsRight,
                );
                if (buttonCol === col) {
                  const buttonX = x + w / 2;
                  const buttonY =
                    (group.level - 1) * OUTLINE_LEVEL_HEIGHT + OUTLINE_LEVEL_HEIGHT / 2;
                  this.renderCollapseButton(ctx, buttonX, buttonY, group.collapsed);
                }
              }
            }
          },
        );
      }
    }

    // Level buttons in corner area
    if (groupingConfig.showOutlineSymbols) {
      this.renderLevelButtons(ctx, maxRowLevel, maxColLevel, rowGutterWidth, colGutterHeight);
    }
  }

  // ===========================================================================
  // Level Buttons (1, 2, 3, ...)
  // ===========================================================================

  private renderLevelButtons(
    ctx: CanvasRenderingContext2D,
    maxRowLevel: number,
    maxColLevel: number,
    rowGutterWidth: number,
    colGutterHeight: number,
  ): void {
    ctx.font = `${OUTLINE_FONT_SIZE}px Calibri, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Row level buttons
    if (maxRowLevel > 0) {
      for (let level = 1; level <= maxRowLevel + 1; level++) {
        const x = (level - 1) * OUTLINE_LEVEL_WIDTH + OUTLINE_LEVEL_WIDTH / 2;
        const y = colGutterHeight > 0 ? colGutterHeight / 2 : COL_HEADER_HEIGHT / 2;
        this.renderLevelButton(ctx, x, y, level);
      }
    }

    // Column level buttons
    if (maxColLevel > 0) {
      for (let level = 1; level <= maxColLevel + 1; level++) {
        const x = rowGutterWidth > 0 ? rowGutterWidth / 2 : ROW_HEADER_WIDTH / 2;
        const y = (level - 1) * OUTLINE_LEVEL_HEIGHT + OUTLINE_LEVEL_HEIGHT / 2;
        this.renderLevelButton(ctx, x, y, level);
      }
    }
  }

  private renderLevelButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    level: number,
  ): void {
    const size = OUTLINE_BUTTON_SIZE;
    const halfSize = size / 2;

    ctx.fillStyle = OUTLINE_BUTTON_BG;
    ctx.strokeStyle = OUTLINE_BUTTON_BORDER;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.roundRect(x - halfSize, y - halfSize, size, size, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = OUTLINE_TEXT_COLOR;
    ctx.fillText(String(level), x, y);
  }

  // ===========================================================================
  // Collapse/Expand Buttons (+/-)
  // ===========================================================================

  private renderCollapseButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    collapsed: boolean,
  ): void {
    const size = OUTLINE_BUTTON_SIZE;
    const halfSize = size / 2;

    ctx.fillStyle = OUTLINE_BUTTON_BG;
    ctx.strokeStyle = OUTLINE_BUTTON_BORDER;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.roundRect(x - halfSize, y - halfSize, size, size, 2);
    ctx.fill();
    ctx.stroke();

    // +/- symbol
    ctx.strokeStyle = OUTLINE_TEXT_COLOR;
    ctx.lineWidth = 1.5;

    // Horizontal line (always)
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x + 3, y);
    ctx.stroke();

    // Vertical line (only for collapsed = +)
    if (collapsed) {
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y + 3);
      ctx.stroke();
    }
  }

  // ===========================================================================
  // Level Bars
  // ===========================================================================

  private renderRowLevelBars(
    ctx: CanvasRenderingContext2D,
    gutterX: number,
    rowY: number,
    rowHeight: number,
    level: number,
  ): void {
    ctx.strokeStyle = OUTLINE_BAR_COLOR;
    ctx.lineWidth = 1;

    for (let l = 1; l <= level; l++) {
      const barX = gutterX + (l - 0.5) * OUTLINE_LEVEL_WIDTH;
      ctx.beginPath();
      ctx.moveTo(barX, rowY);
      ctx.lineTo(barX, rowY + rowHeight);
      ctx.stroke();
    }
  }

  private renderColLevelBars(
    ctx: CanvasRenderingContext2D,
    colX: number,
    gutterY: number,
    colWidth: number,
    level: number,
  ): void {
    ctx.strokeStyle = OUTLINE_BAR_COLOR;
    ctx.lineWidth = 1;

    for (let l = 1; l <= level; l++) {
      const barY = gutterY + (l - 0.5) * OUTLINE_LEVEL_HEIGHT;
      ctx.beginPath();
      ctx.moveTo(colX, barY);
      ctx.lineTo(colX + colWidth, barY);
      ctx.stroke();
    }
  }

  // ===========================================================================
  // Chrome Exemptions (OnceLayerWithChrome)
  // ===========================================================================

  /**
   * Canvas-spanning chrome rects this layer paints into. Co-located with
   * the chrome paint code in this file so the two can drift in lockstep
   * — adding a new chrome paint above without updating this list will
   * fail the structural containment test in
   * `__tests__/once-layer-region-paint-containment.test.ts`.
   */
  getChromeExemptions(args: {
    readonly layout: {
      readonly regions: ReadonlyArray<{
        readonly bounds: {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        };
      }>;
    };
    readonly canvasWidth: number;
    readonly canvasHeight: number;
    readonly dpr: number;
  }): ReadonlyArray<{ x: number; y: number; width: number; height: number }> {
    const { canvasWidth, canvasHeight } = args;
    const showRowHeaders = this.sheet.showRowHeaders;
    const showColumnHeaders = this.sheet.showColumnHeaders;
    if (!showRowHeaders && !showColumnHeaders) return [];

    const maxRowLevel = this.grouping.maxRowOutlineLevel;
    const maxColLevel = this.grouping.maxColOutlineLevel;
    const rowGutterWidth = maxRowLevel > 0 ? maxRowLevel * OUTLINE_LEVEL_WIDTH : 0;
    const colGutterHeight = maxColLevel > 0 ? maxColLevel * OUTLINE_LEVEL_HEIGHT : 0;

    const effectiveRowHeaderWidth = showRowHeaders ? ROW_HEADER_WIDTH : 0;
    const effectiveColHeaderHeight = showColumnHeaders ? COL_HEADER_HEIGHT : 0;
    const totalRowHeaderWidth = effectiveRowHeaderWidth + rowGutterWidth;
    const totalColHeaderHeight = effectiveColHeaderHeight + colGutterHeight;

    const rects: Array<{ x: number; y: number; width: number; height: number }> = [];

    // Column-header band: spans canvas-width, x ∈ [totalRowHeaderWidth,
    // canvasWidth], y ∈ [colGutterHeight, totalColHeaderHeight]. Chrome
    // because the background fill and bottom border paint here regardless
    // of any single region's bounds.
    if (showColumnHeaders) {
      rects.push({
        x: totalRowHeaderWidth,
        y: colGutterHeight,
        width: canvasWidth - totalRowHeaderWidth,
        height: COL_HEADER_HEIGHT,
      });
    }

    // Row-header band: full canvas-height, x ∈ [rowGutterWidth, totalRowHeaderWidth].
    if (showRowHeaders) {
      rects.push({
        x: rowGutterWidth,
        y: totalColHeaderHeight,
        width: ROW_HEADER_WIDTH,
        height: canvasHeight - totalColHeaderHeight,
      });
    }

    // Corner cell (background fill, two borders, diagonal arrow icon).
    if (showRowHeaders && showColumnHeaders) {
      rects.push({
        x: 0,
        y: 0,
        width: totalRowHeaderWidth,
        height: totalColHeaderHeight,
      });
    }

    // Outline-gutter chrome (only when grouping is active):
    if (maxRowLevel > 0) {
      // Row-outline gutter background + right border.
      rects.push({
        x: 0,
        y: totalColHeaderHeight,
        width: rowGutterWidth,
        height: canvasHeight - totalColHeaderHeight,
      });
    }
    if (maxColLevel > 0) {
      // Col-outline gutter background + bottom border.
      rects.push({
        x: totalRowHeaderWidth,
        y: 0,
        width: canvasWidth - totalRowHeaderWidth,
        height: colGutterHeight,
      });
    }

    return rects;
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setConfig(config: Partial<HeadersLayerConfig>): void {
    this.config = { ...this.config, ...config };
    this.markDirty();
  }

  getConfig(): Required<HeadersLayerConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createHeadersLayer(
  sheet: SheetDataSource,
  positionIndex: ViewportPositionIndex,
  selection: SelectionDataSource,
  grouping: GroupingDataSource,
  config?: HeadersLayerConfig,
): HeadersLayer {
  return new HeadersLayer(sheet, positionIndex, selection, grouping, config);
}
