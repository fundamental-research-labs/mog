/**
 * Cells Layer
 *
 * The main cell rendering layer that orchestrates all cell painting:
 * - Pass 1 (backgrounds): fills, borders, data bars
 * - Pass 2 (content): text, icons, indicators, sparklines
 *
 * Between passes, CellRenderInfo is collected and cached so Pass 2
 * can reuse format/value data computed in Pass 1.
 *
 * renderMode: 'per-region' | canvas: 0 | z-index: 100
 *
 * @module grid-renderer/layers/cells
 */

import type {
  DirtyCellExpander,
  FrameContext,
  RenderRegion,
  TextMeasurer,
} from '@mog/canvas-engine';
import { canvasToDoc } from '@mog/canvas-engine';
import type { CellFormat, FormattedText } from '@mog-sdk/contracts/core';
import { displayString } from '@mog-sdk/contracts/core';
import { detectFormatType } from '@mog/spreadsheet-utils/number-formats';
import type {
  CellDataSource,
  DataBarData,
  GridRegionMeta,
  IconData,
  InteractiveElementCollector,
  SelectionDataSource,
  SheetDataSource,
} from '@mog-sdk/contracts/rendering';
import type { RichTextSegment } from '@mog-sdk/contracts/rich-text';

import {
  renderCenterContinuousText,
  renderAccountingText,
  renderDistributedHorizontalText,
  renderFillAlignmentText,
} from '../cells/alignment';
import { renderBorders } from '../cells/borders';
import { renderDataBar, renderDataBarWithAxis } from '../cells/data-bars';
import { renderCellFill } from '../cells/fills';
import { renderIcon } from '../cells/icon-sets';
import {
  renderBindingStatus,
  renderCheckbox,
  renderCommentIndicator,
  renderDropdownIndicator,
  renderFilterButton,
  getFilterButtonTextContentWidth,
  renderValidationError,
} from '../cells/indicators';
import {
  collectInteractiveElements,
  toInteractiveViewportBounds,
  type InteractiveCellInfo,
} from '../cells/interactive-elements';
import { collectVisibleInteractiveElements } from '../cells/visible-interactive-elements';
import { renderRichText, renderRichTextWrapped } from '../cells/rich-text';
import { renderRotatedText } from '../cells/rotated-text';
import { renderShrinkToFit } from '../cells/shrink-to-fit';
import { SparklineRenderer, createSparklineRenderer } from '../cells/sparklines';
import { buildCellFont, mapHorizontalAlign, renderNormalText } from '../cells/text';
import {
  calculateTextOverflow,
  canValueOverflow,
  trackClippedCell,
  type ClippedCellMap,
} from '../cells/text-overflow';
import { renderWrappedText } from '../cells/text-wrap';
import type { CellRenderInfo } from '../cells/types';
import type { CenterAcrossRenderSpan, CenterAcrossSpanProvider } from '../cells/center-across';
import type { ViewportMergeIndex } from '../coordinates/viewport-merge-index';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { forEachVisibleCell } from '../layout/for-each-visible-cell';
import { docToRegionXY, getCellBounds } from '../shared/cell-bounds';
import { OverflowIndex } from '../overflow-index';
import { BaseLayer } from './base-layer';
import type { VisibleCellInfo } from '../layout/types';

// =============================================================================
// Binary Cell Reader (duck-typed interface matching CellAccessor)
// =============================================================================

/**
 * Flyweight reader for binary viewport buffer cells.
 *
 * Duck-typed to match `CellAccessor` from `@mog-sdk/kernel/viewport` without
 * introducing a hard dependency from grid-renderer → kernel. When the binary
 * viewport buffer is active, a single `BinaryCellReader` instance is reused
 * across all cells in a frame via `moveTo(row, col)`.
 *
 * Flag-based properties (`hasComment`, `isCheckbox`, etc.) are read directly
 * from a 16-bit flags field in the binary buffer — no JS object allocation.
 */
export interface BinaryCellReader {
  /** Move the reader to the cell at (row, col). Returns false if out of bounds. */
  moveTo(row: number, col: number): boolean;

  // Value fields
  /** Value type enum: Null=0, Number=1, Text=2, Bool=3, Error=4 */
  readonly valueType: number;
  /** Numeric value (only meaningful when valueType === Number) */
  readonly numberValue: number;
  /** Pre-formatted display text from the binary buffer (null if none) */
  readonly displayText: FormattedText | null;
  /** Error text (null if none) */
  readonly errorText: string | null;

  // Format
  /** CellFormat resolved from the palette */
  readonly format: import('@mog-sdk/contracts/core').CellFormat;

  // Flag-based booleans (bits of the flags field)
  readonly hasFormula: boolean;
  readonly hasComment: boolean;
  readonly hasSparkline: boolean;
  readonly hasHyperlink: boolean;
  readonly isCheckbox: boolean;
  readonly isProjectedPosition: boolean;
  readonly hasValidationError: boolean;
  readonly hasCellImage?: boolean;

  // CF data from binary viewport buffer
  /** CF background color override as "#RRGGBB", or null if no override. */
  getBgColorOverride(): string | null;
  /** CF font color override as "#RRGGBB", or null if no override. */
  getFontColorOverride(): string | null;
  /** Data bar render data for the current cell, or null if none. */
  getDataBar(): DataBarData | null;
  /** Icon render data for the current cell, or null if none. */
  getIcon(): IconData | null;
  getCellImage?(): unknown | null;

  // Neighbor peek methods (random access without moving the cursor)
  /** Check if a cell at (row, col) is empty without moving the cursor.
   *  Returns true if the cell has a null/empty value type, or is out of viewport bounds. */
  isCellEmpty(row: number, col: number): boolean;
  /** Peek at the format of a cell at (row, col) without moving the cursor.
   *  Returns undefined if out of viewport bounds. */
  peekFormat(row: number, col: number): CellFormat | undefined;
}

// =============================================================================
// Configuration
// =============================================================================

export interface CellsLayerConfig {
  cellData: CellDataSource;
  sheetData: SheetDataSource;
  selectionData: SelectionDataSource;
  positionIndex: ViewportPositionIndex;
  mergeIndex: ViewportMergeIndex;
  textMeasurer: TextMeasurer;
  interactiveElements?: InteractiveElementCollector;
  /** Binary cell reader — single source of truth for cell rendering.
   *  When undefined, cell rendering is skipped until the buffer arrives. */
  binaryCellReader?: BinaryCellReader;
  /**
   * Per-viewport binary cell reader resolver.
   * When set, resolves a BinaryCellReader for each viewport region.
   * Takes precedence over the single `binaryCellReader` when the region
   * has a `viewportId` in its metadata.
   */
  binaryCellReaderForViewport?: (viewportId: string) => BinaryCellReader | undefined;
  centerAcrossSpanProvider?: CenterAcrossSpanProvider;
}

// =============================================================================
// Extended Cell Info (internal, per-frame)
// =============================================================================

/**
 * Extended cell render data attached during Pass 1 for use in Pass 2.
 * Avoids re-fetching data sources in the second pass.
 */
interface CellRenderInfoExtended extends CellRenderInfo {
  /** CF background color override (from color scale or cell-is-rule) */
  bgColorOverride: string | null;
  /** CF font color override */
  fontColorOverride: string | null;
  /** CF data bar data */
  dataBar: DataBarData | null;
  /** CF icon data */
  iconData: IconData | null;
  /** Whether cell has a hyperlink */
  hasHyperlink: boolean;
  /** Whether cell is a checkbox */
  isCheckbox: boolean;
  /** Whether cell has a comment */
  hasComment: boolean;
  /** Whether cell is a spill member */
  isProjectedPosition: boolean;
  /** Whether cell has validation errors */
  hasValidationErrors: boolean;
  /** Sparkline render data */
  sparklineData: unknown;
  /** Rich text segments (if value is rich text) */
  richTextSegments: readonly RichTextSegment[] | undefined;
  /** Filter header info */
  filterInfo: { filterId: string; headerCellId: string; hasActiveFilter: boolean } | undefined;
  /** Whether zero value display is suppressed */
  suppressZeroDisplay: boolean;
  /** Structured in-cell image data, when the value is an IMAGE result */
  cellImage: InCellImageData | null;
  /** Sheet ID */
  sheetId: string;
}

interface InCellImageData {
  source: string;
  altText?: string | null;
  sizing?: 'fit' | 'fill' | 'original' | 'custom';
  height?: number | null;
  width?: number | null;
}

// =============================================================================
// Cells Layer
// =============================================================================

export class CellsLayer extends BaseLayer implements DirtyCellExpander {
  private cellData: CellDataSource;
  private sheetData: SheetDataSource;
  private selectionData: SelectionDataSource;
  private positionIndex: ViewportPositionIndex;
  private mergeIndex: ViewportMergeIndex;
  private textMeasurer: TextMeasurer;
  private interactiveElements: InteractiveElementCollector | undefined;
  private sparklineRenderer: SparklineRenderer;
  private clippedCells: ClippedCellMap = new Map();
  private binaryCellReader: BinaryCellReader | undefined;
  private binaryCellReaderForViewport:
    | ((viewportId: string) => BinaryCellReader | undefined)
    | undefined;
  private readonly imageCache = new Map<string, HTMLImageElement | 'loading' | 'error'>();
  private centerAcrossSpanProvider: CenterAcrossSpanProvider | undefined;
  private overflowIndex = new OverflowIndex();
  private preparedFrame: FrameContext | null = null;

  constructor(config: CellsLayerConfig) {
    super({
      id: 'cells',
      zIndex: 100,
      renderMode: 'per-region',
      canvas: 0,
    });
    this.cellData = config.cellData;
    this.sheetData = config.sheetData;
    this.selectionData = config.selectionData;
    this.positionIndex = config.positionIndex;
    this.mergeIndex = config.mergeIndex;
    this.textMeasurer = config.textMeasurer;
    this.interactiveElements = config.interactiveElements;
    this.binaryCellReader = config.binaryCellReader;
    this.binaryCellReaderForViewport = config.binaryCellReaderForViewport;
    this.centerAcrossSpanProvider = config.centerAcrossSpanProvider;
    this.sparklineRenderer = createSparklineRenderer();
  }

  // ===========================================================================
  // Data Source Updates
  // ===========================================================================

  updateDataSources(config: Partial<CellsLayerConfig>): void {
    if (config.cellData !== undefined) this.cellData = config.cellData;
    if (config.sheetData !== undefined) this.sheetData = config.sheetData;
    if (config.selectionData !== undefined) this.selectionData = config.selectionData;
    if (config.positionIndex !== undefined) this.positionIndex = config.positionIndex;
    if (config.mergeIndex !== undefined) this.mergeIndex = config.mergeIndex;
    if (config.textMeasurer !== undefined) this.textMeasurer = config.textMeasurer;
    if (config.interactiveElements !== undefined)
      this.interactiveElements = config.interactiveElements;
    if (config.binaryCellReader !== undefined) this.binaryCellReader = config.binaryCellReader;
    if (config.binaryCellReaderForViewport !== undefined)
      this.binaryCellReaderForViewport = config.binaryCellReaderForViewport;
    if (config.centerAcrossSpanProvider !== undefined)
      this.centerAcrossSpanProvider = config.centerAcrossSpanProvider;
    this.markDirty();
  }

  /** Get the clipped cells map for tooltip display */
  getClippedCells(): ClippedCellMap {
    return this.clippedCells;
  }

  // ===========================================================================
  // Dirty Cell Expansion (DirtyCellExpander)
  // ===========================================================================

  expandDirtyCells(cells: { row: number; col: number }[]): { row: number; col: number }[] {
    const expanded = new Map<string, { row: number; col: number }>();

    // Add all original cells
    for (const cell of cells) {
      expanded.set(`${cell.row},${cell.col}`, cell);
    }

    // Expand using OverflowIndex
    for (const cell of cells) {
      // Reverse lookup: who was overflowing into this cell?
      const sources = this.overflowIndex.getOverflowSources(cell.row, cell.col);
      if (sources) {
        for (const sourceCol of sources) {
          const key = `${cell.row},${sourceCol}`;
          if (!expanded.has(key)) {
            expanded.set(key, { row: cell.row, col: sourceCol });
          }
        }
      }

      // Forward lookup: where was this cell overflowing to?
      const extent = this.overflowIndex.getOverflowExtent(cell.row, cell.col);
      if (extent) {
        for (let c = extent.startCol; c <= extent.endCol; c++) {
          const key = `${cell.row},${c}`;
          if (!expanded.has(key)) {
            expanded.set(key, { row: cell.row, col: c });
          }
        }
      }
    }

    return Array.from(expanded.values());
  }

  // ===========================================================================
  // Render
  // ===========================================================================

  beginFrame(frame: FrameContext): void {
    this.prepareFrame(frame);
  }

  private prepareFrame(frame: FrameContext): void {
    if (this.preparedFrame === frame) {
      return;
    }
    this.preparedFrame = frame;

    // Frame-scoped outputs accumulate across every region rendered for this layer.
    this.clippedCells.clear();
    this.interactiveElements?.clear();

    // Clear overflow index on full repaint; partial repaints update incrementally.
    if (!frame.dirtyRects || frame.dirtyRects.length === 0) {
      this.overflowIndex.clear();
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    region: RenderRegion<GridRegionMeta>,
    frame: FrameContext,
  ): void {
    this.prepareFrame(frame);

    const meta = region.metadata;
    const sheetId = meta.sheetId;
    const { cellData, sheetData, selectionData, positionIndex, mergeIndex } = this;
    const editorState = selectionData.getEditorState();
    const theme = sheetData.theme;
    const dpr = frame.dpr;

    // Collect CellRenderInfo in Pass 1 for reuse in Pass 2
    const cellInfoCache: CellRenderInfoExtended[] = [];

    // =========================================================================
    // PASS 1: Fills, borders, data bars
    // =========================================================================

    // Binary cell reader for the hot path (if available).
    // Resolve per-viewport reader when viewportId is set on the region.
    const viewportId = meta.viewportId;
    const reader =
      viewportId && this.binaryCellReaderForViewport
        ? this.binaryCellReaderForViewport(viewportId)
        : this.binaryCellReader;

    // Convert canvas-space dirty rects to doc-space for forEachVisibleCell filtering.
    // forEachVisibleCell compares against doc-space cell positions from ViewportPositionIndex,
    // so we must convert frame.dirtyRects (canvas-space) to doc-space using the region transform.
    const dirtyRectsDoc = frame.dirtyRects?.map((r) => canvasToDoc(r, region));
    if (dirtyRectsDoc && dirtyRectsDoc.length > 0 && this.interactiveElements) {
      collectVisibleInteractiveElements(
        sheetId,
        meta.cellRange,
        region,
        cellData,
        positionIndex,
        mergeIndex,
        reader,
        editorState,
        this.interactiveElements,
      );
    }

    const renderFilterOnlyCell = (
      cell: VisibleCellInfo,
      filterInfo: NonNullable<CellRenderInfoExtended['filterInfo']>,
    ) => {
      const local = docToRegionXY(cell.x, cell.y, region);
      const mergeLocal = cell.merge
        ? docToRegionXY(cell.merge.mergeX, cell.merge.mergeY, region)
        : undefined;
      const fallbackCellInfo: CellRenderInfo = {
        row: cell.row,
        col: cell.col,
        x: local.x,
        y: local.y,
        width: cell.width,
        height: cell.height,
        value: null,
        format: undefined,
        displayText: '',
        isEditing: false,
        merge: cell.merge
          ? {
              originRow: cell.merge.originRow,
              originCol: cell.merge.originCol,
              mergeWidth: cell.merge.mergeWidth,
              mergeHeight: cell.merge.mergeHeight,
              mergeX: mergeLocal!.x,
              mergeY: mergeLocal!.y,
            }
          : undefined,
      };
      const contentBounds = getCellBounds(fallbackCellInfo);
      const controlSkin = this.sheetData.sheetViewSkin.controls;
      renderFilterButton(
        ctx,
        contentBounds.x,
        contentBounds.y,
        contentBounds.width,
        contentBounds.height,
        filterInfo.hasActiveFilter,
        controlSkin,
      );
      if (this.interactiveElements) {
        collectInteractiveElements(
          fallbackCellInfo,
          {
            hasComment: false,
            isCheckbox: false,
            isChecked: false,
            filterInfo,
            sheetId,
          },
          this.interactiveElements,
          (bounds) => toInteractiveViewportBounds(bounds, region),
        );
      }
    };

    forEachVisibleCell(
      meta.cellRange,
      positionIndex,
      mergeIndex,
      (cell) => {
        const coord = { row: cell.row, col: cell.col };
        this.overflowIndex.removeCell(cell.row, cell.col);

        // Skip the cell currently being edited (the editor overlay covers it)
        if (
          editorState.isEditing &&
          editorState.editingCell !== null &&
          editorState.editingCell.row === cell.row &&
          editorState.editingCell.col === cell.col
        ) {
          return;
        }

        // -----------------------------------------------------------------------
        // Fetch cell data from binary viewport buffer (single source of truth)
        // -----------------------------------------------------------------------
        // The binary reader provides all per-cell rendering data: flags, format,
        // value, display text, CF overrides. CellDataSource is only used for
        // metadata not yet in the binary buffer (sparklines, filters, bindings).
        // -----------------------------------------------------------------------
        const filterHeaderInfo = cellData.getFilterHeaderInfo(sheetId, coord);
        const filterInfo = filterHeaderInfo
          ? {
              filterId: filterHeaderInfo.filterId,
              headerCellId: filterHeaderInfo.headerCellId,
              hasActiveFilter: filterHeaderInfo.hasActiveFilter,
            }
          : undefined;

        const local = docToRegionXY(cell.x, cell.y, region);
        const mergeLocal = cell.merge
          ? docToRegionXY(cell.merge.mergeX, cell.merge.mergeY, region)
          : undefined;

        // Binary buffer is the single source of truth for value/format rendering.
        // moveTo returns false when the cell is outside the binary buffer's prefetch
        // bounds (rapid scroll). A new viewport fetch is in-flight. Skipping for 1-2
        // frames is correct — showing data from a different source would risk divergence.
        //
        // Filter buttons are different: their metadata is provided by the synchronous
        // filter-header cache, not the binary value buffer. Frozen panes can briefly
        // have a visible header cell whose viewport reader cannot move to that cell;
        // still render/collect the filter affordance so DOM overlays stay usable.
        if (!reader?.moveTo(cell.row, cell.col)) {
          if (filterInfo) {
            renderFilterOnlyCell(cell, filterInfo);
          }
          return;
        }

        // Flag-based booleans from binary reader
        const hasHyperlink = reader.hasHyperlink;
        const isCheckbox = reader.isCheckbox;
        const hasComment = reader.hasComment;
        const isProjectedPosition = reader.isProjectedPosition;
        const hasValidationErrors = reader.hasValidationError;

        // Format from binary reader palette lookup
        const format = reader.format;

        // Value: reconstruct a lightweight JS value from binary fields.
        // The binary buffer stores valueType + numberValue but not arbitrary JS values.
        // For the renderer, the raw value is needed for: rich text detection, checkbox
        // value comparison, zero suppression, overflow heuristics, and alignment inference.
        const value = binaryValueToRenderValue(reader);

        // Determine if zero display is suppressed
        const suppressZeroDisplay =
          !cellData.showZeroValues && typeof value === 'number' && value === 0;

        // Display text: binary reader provides pre-formatted text from Rust
        const displayText = suppressZeroDisplay
          ? ''
          : reader.displayText
            ? displayString(reader.displayText)
            : '';

        // CF data from binary buffer: per-cell color overrides, data bars, and icons
        // from the Rust CF cache — no TS-side evaluation needed.
        const bgColorOverride = reader.getBgColorOverride();
        const fontColorOverride = reader.getFontColorOverride();
        const dataBar = reader.getDataBar();
        const iconData = reader.getIcon();
        const cellImage = normalizeInCellImage(reader.getCellImage?.() ?? null);
        const sparklineData = reader.hasSparkline
          ? cellData.getSparklineRenderData(sheetId, coord)
          : undefined;
        const bindingStatus = cellData.getCellBindingStatus(sheetId, coord);

        // Detect rich text segments (rich text is never in the binary buffer)
        const richTextSegments = isRichTextValue(value)
          ? (value as { segments: readonly RichTextSegment[] }).segments
          : undefined;

        // Build CellRenderInfo (document coords → region-local UNZOOMED via canonical helper)
        const cellInfo: CellRenderInfoExtended = {
          row: cell.row,
          col: cell.col,
          x: local.x,
          y: local.y,
          width: cell.width,
          height: cell.height,
          value,
          format,
          displayText,
          isEditing: false,
          merge: cell.merge
            ? {
                originRow: cell.merge.originRow,
                originCol: cell.merge.originCol,
                mergeWidth: cell.merge.mergeWidth,
                mergeHeight: cell.merge.mergeHeight,
                mergeX: mergeLocal!.x,
                mergeY: mergeLocal!.y,
              }
            : undefined,
          bgColorOverride,
          fontColorOverride,
          dataBar,
          iconData,
          hasHyperlink,
          isCheckbox,
          hasComment,
          isProjectedPosition,
          hasValidationErrors,
          sparklineData,
          richTextSegments,
          filterInfo,
          suppressZeroDisplay,
          cellImage,
          sheetId,
        };

        cellInfoCache.push(cellInfo);

        // --- Render fill ---
        renderCellFill(ctx, cellInfo, format, {
          bgColorOverride,
          isProjectedPosition,
          sheetViewSkin: this.sheetData.sheetViewSkin,
        });

        // --- Render borders ---
        // CF borders are now baked into the palette format — no separate CF override needed.
        renderBorders(ctx, cellInfo, dpr);

        // --- Render data bar (behind text, part of Pass 1) ---
        if (dataBar) {
          const dbBounds = getCellBounds(cellInfo);
          if (dataBar.showAxis) {
            renderDataBarWithAxis(ctx, dataBar, dbBounds, dataBar.axisPosition);
          } else {
            renderDataBar(ctx, dataBar, dbBounds);
          }
        }

        // --- Render binding status indicator ---
        if (bindingStatus) {
          renderBindingStatus(ctx, cellInfo.x, cellInfo.y, cellInfo.height, bindingStatus);
        }
      },
      dirtyRectsDoc,
    );

    const { startRow, startCol, endRow, endCol } = meta.cellRange;
    const filterFringeRange = {
      startRow,
      startCol: Math.max(0, startCol - 1),
      endRow,
      endCol: endCol + 1,
    };
    if (filterFringeRange.startCol < startCol || filterFringeRange.endCol > endCol) {
      forEachVisibleCell(filterFringeRange, positionIndex, mergeIndex, (cell) => {
        if (
          cell.row >= startRow &&
          cell.row <= endRow &&
          cell.col >= startCol &&
          cell.col <= endCol
        ) {
          return;
        }

        const filterHeaderInfo = cellData.getFilterHeaderInfo(sheetId, {
          row: cell.row,
          col: cell.col,
        });
        if (!filterHeaderInfo) return;

        renderFilterOnlyCell(cell, {
          filterId: filterHeaderInfo.filterId,
          headerCellId: filterHeaderInfo.headerCellId,
          hasActiveFilter: filterHeaderInfo.hasActiveFilter,
        });
      });
    }

    // =========================================================================
    // PASS 2: Text, icons, indicators, sparklines
    // =========================================================================

    const centerAcrossPaintedSources = reader
      ? this.renderCenterAcrossSpans(ctx, meta, region, cellInfoCache, reader, frame)
      : new Set<string>();

    for (const cellInfo of cellInfoCache) {
      const {
        format,
        value,
        displayText,
        hasHyperlink,
        isCheckbox,
        hasComment,
        hasValidationErrors: hasValErrors,
        sparklineData,
        richTextSegments,
        iconData: cfIconData,
        cellImage,
        filterInfo,
        suppressZeroDisplay,
        fontColorOverride,
        row,
        col,
      } = cellInfo;

      const contentBounds = getCellBounds(cellInfo);
      const controlSkin = this.sheetData.sheetViewSkin.controls;

      // --- Render CF icon ---
      let iconOffset = 0;
      if (cfIconData) {
        iconOffset = renderIcon(ctx, cfIconData, {
          x: contentBounds.x,
          y: contentBounds.y,
          width: contentBounds.width,
          height: contentBounds.height,
        });
      }

      // --- Render sparkline ---
      if (sparklineData) {
        const sd = sparklineData as import('@mog-sdk/contracts/sparklines').SparklineRenderData;
        this.sparklineRenderer.render(
          ctx,
          sd,
          contentBounds.x,
          contentBounds.y,
          contentBounds.width,
          contentBounds.height,
        );
      }

      // --- Render checkbox (replaces text for checkbox cells) ---
      if (isCheckbox) {
        renderCheckbox(
          ctx,
          value,
          contentBounds.x,
          contentBounds.y,
          contentBounds.width,
          contentBounds.height,
          controlSkin,
        );
      }

      if (cellImage && !isCheckbox) {
        this.renderInCellImage(ctx, cellImage, contentBounds, displayText);
      }

      // --- Render text content ---
      // Skip text if: editing, checkbox, icon-only CF, zero suppressed, or no text
      const shouldRenderText =
        !cellImage &&
        !isCheckbox &&
        !cfIconData?.iconOnly &&
        !suppressZeroDisplay &&
        displayText.length > 0;

      if (shouldRenderText && !centerAcrossPaintedSources.has(`${row},${col}`)) {
        const textContentWidth = filterInfo
          ? getFilterButtonTextContentWidth(contentBounds.width)
          : contentBounds.width;
        const baseTextCellInfo: CellRenderInfo = {
          ...cellInfo,
          x: contentBounds.x,
          y: contentBounds.y,
          width: textContentWidth,
          height: contentBounds.height,
        };
        // Apply icon offset to cell info for text rendering
        const textCellInfo: CellRenderInfo =
          iconOffset > 0
            ? {
                ...baseTextCellInfo,
                x: baseTextCellInfo.x + iconOffset,
                width: Math.max(0, baseTextCellInfo.width - iconOffset),
              }
            : baseTextCellInfo;

        this.renderCellText(
          ctx,
          textCellInfo,
          format,
          value,
          displayText,
          richTextSegments,
          hasHyperlink,
          fontColorOverride,
          meta,
          frame,
          reader!,
        );
      }

      // --- Render indicators ---
      if (hasComment) {
        renderCommentIndicator(
          ctx,
          contentBounds.x,
          contentBounds.y,
          contentBounds.width,
          controlSkin,
        );
      }

      if (filterInfo) {
        renderFilterButton(
          ctx,
          contentBounds.x,
          contentBounds.y,
          contentBounds.width,
          contentBounds.height,
          filterInfo.hasActiveFilter,
          controlSkin,
        );
      }

      if (cellData.dropdownCells.has(`${row},${col}`)) {
        renderDropdownIndicator(
          ctx,
          contentBounds.x,
          contentBounds.y,
          contentBounds.width,
          contentBounds.height,
          controlSkin,
        );
      }

      if (hasValErrors) {
        renderValidationError(ctx, contentBounds.x, contentBounds.y, controlSkin);
      }

      // --- Collect interactive elements ---
      if (this.interactiveElements) {
        const interactiveInfo: InteractiveCellInfo = {
          hasComment,
          isCheckbox,
          isChecked: value === true || value === 'TRUE' || value === 1,
          filterInfo,
          sheetId,
        };
        collectInteractiveElements(cellInfo, interactiveInfo, this.interactiveElements, (bounds) =>
          toInteractiveViewportBounds(bounds, region),
        );
      }
    }
  }

  // ===========================================================================
  // Text Rendering Dispatch
  // ===========================================================================

  /**
   * Dispatch to the appropriate text renderer based on format properties.
   *
   * Priority (first match wins):
   * 1. Rich text with wrap -> renderRichTextWrapped
   * 2. Rich text -> renderRichText
   * 3. Rotated text (textRotation != 0 and != undefined) -> renderRotatedText
   * 4. Fill alignment -> renderFillAlignmentText
   * 5. CenterContinuous alignment -> renderCenterContinuousText
   * 6. Distributed horizontal alignment -> renderDistributedHorizontalText
   * 7. Wrap text -> renderWrappedText
   * 8. Accounting format -> renderAccountingText
   * 9. Shrink to fit -> renderShrinkToFit
   * 10. Normal text (with overflow handling) -> renderNormalText
   */
  private renderCellText(
    ctx: CanvasRenderingContext2D,
    cellInfo: CellRenderInfo,
    format: CellFormat | undefined,
    value: unknown,
    displayText: string,
    richTextSegments: readonly RichTextSegment[] | undefined,
    hasHyperlink: boolean,
    fontColorOverride: string | null,
    meta: GridRegionMeta,
    _frame: FrameContext,
    reader: BinaryCellReader,
  ): void {
    const theme = this.sheetData.theme;
    const defaultFontColor = this.sheetData.sheetViewSkin.defaultCellText;
    const textMeasurer = this.textMeasurer;
    const { x, y, width, height, row, col } = cellInfo;
    const hasHardLineBreaks = /[\r\n]/.test(displayText);

    // 1. Rich text
    if (richTextSegments && richTextSegments.length > 0) {
      if (format?.wrapText) {
        renderRichTextWrapped(ctx, richTextSegments, x, y, width, height, format, {
          clipText: true,
          theme,
          textMeasurer,
          fontColorOverride,
          defaultFontColor,
        });
      } else {
        renderRichText(ctx, richTextSegments, row, col, x, y, width, height, format, {
          clipText: true,
          theme,
          textMeasurer,
          trackClippedCell: (r, c, text) => trackClippedCell(this.clippedCells, r, c, text),
          fontColorOverride,
          defaultFontColor,
        });
      }
      return;
    }

    // 2. Rotated text (textRotation != 0 and != undefined)
    if (format?.textRotation !== undefined && format.textRotation !== 0) {
      renderRotatedText(ctx, cellInfo, format, format.textRotation, {
        hasHyperlink,
        isCutCell: false,
        theme,
        textMeasurer,
        fontColorOverride,
        defaultFontColor,
      });
      return;
    }

    // 3. Fill alignment
    if (format?.horizontalAlign === 'fill') {
      renderFillAlignmentText(
        ctx,
        displayText,
        x,
        y,
        width,
        height,
        format,
        theme,
        fontColorOverride,
        defaultFontColor,
      );
      return;
    }

    // 4. CenterContinuous alignment
    if (format?.horizontalAlign === 'centerContinuous') {
      const ccResult = renderCenterContinuousText(
        ctx,
        displayText,
        row,
        col,
        x,
        y,
        width,
        height,
        format,
        theme,
        {
          positionIndex: this.positionIndex,
          totalCols: this.sheetData.totalCols,
          isCellEmpty: (r, c) => reader.isCellEmpty(r, c),
          peekFormat: (r, c) => reader.peekFormat(r, c),
        },
        fontColorOverride,
        defaultFontColor,
      );
      if (ccResult) {
        this.overflowIndex.record(row, col, ccResult.extendedStartCol, ccResult.extendedEndCol);
      }
      return;
    }

    // 5. Distributed horizontal alignment (non-wrap)
    if (format?.horizontalAlign === 'distributed' && !format.wrapText && !hasHardLineBreaks) {
      renderDistributedHorizontalText(
        ctx,
        displayText,
        x,
        y,
        width,
        height,
        format,
        theme,
        fontColorOverride,
        defaultFontColor,
      );
      return;
    }

    // 6. Multi-line text
    if (format?.wrapText || hasHardLineBreaks) {
      renderWrappedText(ctx, cellInfo, format, {
        hasHyperlink,
        isCutCell: false,
        theme,
        textMeasurer,
        fontColorOverride,
        defaultFontColor,
      });
      return;
    }

    // 7. Accounting number formats split the currency symbol and amount.
    if (format?.numberFormat && detectFormatType(format.numberFormat) === 'accounting') {
      renderAccountingText(
        ctx,
        displayText,
        x,
        y,
        width,
        height,
        format,
        hasHyperlink,
        theme,
        fontColorOverride,
        defaultFontColor,
      );
      return;
    }

    // 8. Shrink to fit
    if (format?.shrinkToFit) {
      renderShrinkToFit(ctx, cellInfo, format, {
        hasHyperlink,
        isCutCell: false,
        theme,
        textMeasurer,
        fontColorOverride,
        defaultFontColor,
      });
      return;
    }

    // 9. Normal text with overflow handling
    const font = buildCellFont(format, theme, displayText);
    const textWidth = textMeasurer.measureText(displayText, font).width;
    const hAlign = mapHorizontalAlign(format?.horizontalAlign, value);

    // Calculate overflow for text values
    let overflowResult = null;
    if (canValueOverflow(value) && textWidth > width) {
      overflowResult = calculateTextOverflow({
        row,
        col,
        cellX: x,
        cellWidth: width,
        textWidth,
        alignment: hAlign,
        wrapText: false,
        shrinkToFit: false,
        positionIndex: this.positionIndex,
        mergeIndex: this.mergeIndex,
        isCellEmpty: (r, c) => reader.isCellEmpty(r, c),
        maxCol: meta.cellRange.endCol,
      });

      // Record overflow extent in the index
      if (overflowResult.overflowStartCol !== undefined) {
        this.overflowIndex.record(
          row,
          col,
          overflowResult.overflowStartCol!,
          overflowResult.overflowEndCol!,
        );
      }

      // Track clipped cells for tooltips
      if (overflowResult.isClipped) {
        trackClippedCell(this.clippedCells, row, col, displayText);
      }
    } else if (textWidth > width && !canValueOverflow(value)) {
      // Numbers that don't fit show as clipped (### behavior handled by format-value)
      overflowResult = { renderX: x, renderWidth: width, isClipped: true };
    }

    renderNormalText(ctx, cellInfo, format, textMeasurer, {
      hasHyperlink,
      isCutCell: false,
      theme,
      textMeasurer,
      overflowResult,
      fontColorOverride,
      defaultFontColor,
    });
  }

  private renderInCellImage(
    ctx: CanvasRenderingContext2D,
    imageData: InCellImageData,
    bounds: { x: number; y: number; width: number; height: number },
    fallbackText: string,
  ): void {
    const padding = 2;
    const x = bounds.x + padding;
    const y = bounds.y + padding;
    const width = Math.max(0, bounds.width - padding * 2);
    const height = Math.max(0, bounds.height - padding * 2);
    if (width <= 0 || height <= 0) return;

    const cached = this.getCachedImage(imageData.source);
    if (cached !== 'loading' && cached !== 'error') {
      const rect = fitImageRect(cached, imageData, x, y, width, height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.drawImage(cached, rect.x, rect.y, rect.width, rect.height);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
    const label =
      cached === 'error' ? fallbackText || imageData.altText || '' : imageData.altText || '';
    if (label) {
      ctx.fillStyle = '#64748b';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncateImageFallback(ctx, label, width - 8), x + 4, y + height / 2);
    }
    ctx.restore();
  }

  private getCachedImage(src: string): HTMLImageElement | 'loading' | 'error' {
    const cached = this.imageCache.get(src);
    if (cached) return cached;
    const img = new Image();
    this.imageCache.set(src, 'loading');
    if (src.startsWith('https://') || src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      this.imageCache.set(src, img);
      this.markDirty({ type: 'full' });
    };
    img.onerror = () => {
      this.imageCache.set(src, 'error');
      this.markDirty({ type: 'full' });
    };
    img.src = src;
    return 'loading';
  }

  private renderCenterAcrossSpans(
    ctx: CanvasRenderingContext2D,
    meta: GridRegionMeta,
    region: RenderRegion<GridRegionMeta>,
    cellInfoCache: readonly CellRenderInfoExtended[],
    reader: BinaryCellReader,
    frame: FrameContext,
  ): Set<string> {
    const paintedSources = new Set<string>();
    const provider = this.centerAcrossSpanProvider;
    if (!provider) return paintedSources;

    const rows = new Set<number>();
    for (const cellInfo of cellInfoCache) rows.add(cellInfo.row);

    const paneId = meta.viewportId ?? region.id;
    for (const row of rows) {
      const spans = provider.getCenterAcrossSpans(
        paneId,
        row,
        meta.cellRange.startCol,
        meta.cellRange.endCol,
      );
      for (const span of spans) {
        if (paintedSources.has(`${span.row},${span.sourceCol}`)) continue;
        if (span.sourceCell.displayText.length === 0) continue;
        this.renderProviderCenterAcrossSpan(ctx, span, meta, region, frame, reader);
        paintedSources.add(`${span.row},${span.sourceCol}`);
        this.overflowIndex.record(span.row, span.sourceCol, span.startCol, span.endCol);
      }
    }

    return paintedSources;
  }

  private renderProviderCenterAcrossSpan(
    ctx: CanvasRenderingContext2D,
    span: CenterAcrossRenderSpan,
    meta: GridRegionMeta,
    region: RenderRegion<GridRegionMeta>,
    frame: FrameContext,
    reader: BinaryCellReader,
  ): void {
    const startX = this.positionIndex.getColLeft(span.startCol);
    const endColLeft = this.positionIndex.getColLeft(span.endCol);
    const endColWidth = this.positionIndex.getColWidth(span.endCol);
    const docY = this.positionIndex.getRowTop(span.row);
    const localStart = docToRegionXY(startX, docY, region);
    const source = span.sourceCell;
    const textCellInfo: CellRenderInfo = {
      ...source,
      row: span.row,
      col: span.sourceCol,
      x: localStart.x,
      y: source.y,
      width: endColLeft + endColWidth - startX,
      height: source.height,
      format: { ...source.format, horizontalAlign: 'center' },
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(textCellInfo.x, textCellInfo.y, textCellInfo.width, textCellInfo.height);
    ctx.clip();
    this.renderCellText(
      ctx,
      textCellInfo,
      textCellInfo.format,
      textCellInfo.value,
      textCellInfo.displayText,
      undefined,
      false,
      source.conditionalFontColorOverride ?? null,
      meta,
      frame,
      reader,
    );
    ctx.restore();
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a value is a rich text object (has segments array).
 */
function isRichTextValue(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray((value as { segments?: unknown }).segments)
  );
}

/**
 * Reconstruct a lightweight JS value from binary cell reader fields.
 *
 * The binary buffer stores valueType + numberValue but not arbitrary JS objects.
 * For the renderer, the raw value is needed for:
 * - Rich text detection (always false for binary — rich text not in binary buffer)
 * - Checkbox value comparison (true/false/1)
 * - Zero suppression (number === 0)
 * - Text overflow heuristics (string vs number)
 * - Horizontal alignment inference (left for text, right for numbers)
 *
 * Value type enum: Null=0, Number=1, Text=2, Bool=3, Error=4
 */
function binaryValueToRenderValue(reader: BinaryCellReader): unknown {
  switch (reader.valueType) {
    case 0: // Null
      return null;
    case 1: // Number
      return reader.numberValue;
    case 2: // Text
      return reader.displayText ? displayString(reader.displayText) : '';
    case 3: // Bool
      return reader.numberValue !== 0;
    case 4: // Error
      return reader.errorText ?? '#ERROR!';
    case 5: // Image
      return normalizeInCellImage(reader.getCellImage?.() ?? null);
    default:
      return null;
  }
}

function normalizeInCellImage(value: unknown): InCellImageData | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const source = typeof record.source === 'string' ? record.source : null;
  if (!source) return null;
  const sizing = typeof record.sizing === 'string' ? record.sizing : 'fit';
  return {
    source,
    altText: typeof record.altText === 'string' ? record.altText : null,
    sizing:
      sizing === 'fill' || sizing === 'original' || sizing === 'custom' || sizing === 'fit'
        ? sizing
        : 'fit',
    height: typeof record.height === 'number' ? record.height : null,
    width: typeof record.width === 'number' ? record.width : null,
  };
}

function fitImageRect(
  image: HTMLImageElement,
  imageData: InCellImageData,
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const naturalWidth = image.naturalWidth || image.width || width;
  const naturalHeight = image.naturalHeight || image.height || height;
  if (imageData.sizing === 'custom' && imageData.width && imageData.height) {
    return {
      x,
      y,
      width: Math.min(width, imageData.width),
      height: Math.min(height, imageData.height),
    };
  }
  if (imageData.sizing === 'original') {
    return { x, y, width: naturalWidth, height: naturalHeight };
  }

  const scale =
    imageData.sizing === 'fill'
      ? Math.max(width / naturalWidth, height / naturalHeight)
      : Math.min(width / naturalWidth, height / naturalHeight);
  const drawWidth = naturalWidth * scale;
  const drawHeight = naturalHeight * scale;
  return {
    x: x + (width - drawWidth) / 2,
    y: y + (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

function truncateImageFallback(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next}...`;
}

// =============================================================================
// Factory
// =============================================================================

export function createCellsLayer(config: CellsLayerConfig): CellsLayer {
  return new CellsLayer(config);
}
