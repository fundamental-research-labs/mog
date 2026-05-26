/**
 * Compute Viewport Layout
 *
 * Pure function to compute ViewportLayout from inputs.
 * No side effects, no caching, no state mutation.
 *
 * @module canvas/viewports/compute-layout
 */

import {
  COL_HEADER_HEIGHT,
  computeFrozenRange,
  computeVisibleRange,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  getEffectiveHeaderDimensions,
  ROW_HEADER_WIDTH,
  type ViewportPositionIndex,
} from '@mog/grid-renderer';
import { clampScroll, computeMaxScroll } from './scroll';
import type {
  CellRange,
  ComputeLayoutInput,
  FreezeViewportConfig,
  FrozenBoundaries,
  HeaderRenderInfo,
  OverlayViewportConfig,
  PersistedViewportConfig,
  Point,
  Rect,
  Size,
  SplitViewportConfig,
  Viewport,
  ViewportDivider,
  ViewportLayout,
  ViewportRenderConfig,
} from './types';
import { DEFAULT_VIEWPORT_RENDER_CONFIG } from './types';

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Compute the complete viewport layout from inputs.
 *
 * This is a PURE FUNCTION - it has no side effects, no caching, no state mutation.
 * Call it whenever any input changes to get a fresh layout.
 *
 * @param input - All inputs required to compute the layout
 * @returns Complete viewport layout ready for rendering
 */
export function computeViewportLayout(input: ComputeLayoutInput): ViewportLayout {
  const {
    config,
    containerSize,
    positionIndex,
    scrollPosition,
    scrollPositions, // Per-viewport scroll positions for split view
    overlays,
    zoom = 1.0,
    gutterDimensions = { rowGutterWidth: 0, colGutterHeight: 0 },
    headerVisibility,
  } = input;

  // Get effective header dimensions based on visibility
  const effectiveHeaders = getEffectiveHeaderDimensions(headerVisibility);

  // Compute content size for scroll bounds
  const contentSize = computeContentSize(positionIndex);

  // Compute frozen boundaries (pixel sizes of frozen regions)
  const frozenBoundaries = computeFrozenBoundaries(config, positionIndex);

  // Compute max scroll based on content and viewport size
  const scrollableSize = computeScrollableSize(
    containerSize,
    frozenBoundaries,
    gutterDimensions,
    effectiveHeaders,
  );
  // Subtract frozen region from content size — frozen rows/cols are always visible
  // and never scroll. Don't pass frozenSize to computeMaxScroll because
  // scrollableSize already has frozen size subtracted (would cause double-subtraction).
  const scrollableContentSize = {
    width: contentSize.width - frozenBoundaries.frozenColsWidth,
    height: contentSize.height - frozenBoundaries.frozenRowsHeight,
  };
  const maxScroll = computeMaxScroll(scrollableContentSize, scrollableSize);

  // Clamp scroll position to valid bounds
  const clampedScroll = clampScroll(scrollPosition, maxScroll);

  // Build viewports based on config type
  const { viewports, dividers, primaryViewportId } = buildViewportsForConfig(
    config,
    containerSize,
    positionIndex,
    clampedScroll,
    frozenBoundaries,
    zoom,
    gutterDimensions,
    scrollPositions,
    effectiveHeaders,
  );

  // Add overlay viewports
  const overlayViewports = buildOverlayViewports(overlays, zoom);
  const allViewports = [...viewports, ...overlayViewports];

  // Compute header render info for freeze-aware header rendering
  const headerInfo: HeaderRenderInfo = computeHeaderInfo(
    config,
    frozenBoundaries,
    clampedScroll,
    zoom,
  );

  return {
    viewports: allViewports,
    primaryViewportId,
    dividers,
    contentSize,
    maxScroll,
    headerInfo,
  };
}

// =============================================================================
// Content Size Computation
// =============================================================================

/**
 * Compute total content size using O(1) estimation.
 *
 * IMPORTANT: Uses constant-time estimation instead of iterating over all rows/columns.
 * With Excel-compatible limits (1,048,576 rows × 16,384 cols), iterating would cause
 * the browser to freeze for minutes. This estimation is acceptable because:
 * 1. Scrollbar positioning doesn't need pixel-perfect accuracy
 * 2. Custom row heights can be tracked incrementally in Yjs if precision is needed
 *
 * @see viewport.ts estimateTotalHeight/estimateTotalWidth for the same pattern
 */
function computeContentSize(positionIndex: ViewportPositionIndex): Size {
  const totalRows = positionIndex.totalRows;
  const totalCols = positionIndex.totalCols;

  // O(1) estimation based on default dimensions
  // This avoids O(n) iteration over 1M+ rows which would freeze the browser
  return {
    width: totalCols * DEFAULT_COL_WIDTH,
    height: totalRows * DEFAULT_ROW_HEIGHT,
  };
}

/**
 * Compute the scrollable viewport size (container minus headers, gutters, and frozen regions).
 */
function computeScrollableSize(
  containerSize: Size,
  frozenBoundaries: FrozenBoundaries,
  gutterDimensions: { rowGutterWidth: number; colGutterHeight: number } = {
    rowGutterWidth: 0,
    colGutterHeight: 0,
  },
  effectiveHeaders: { rowHeaderWidth: number; colHeaderHeight: number } = {
    rowHeaderWidth: ROW_HEADER_WIDTH,
    colHeaderHeight: COL_HEADER_HEIGHT,
  },
): Size {
  return {
    width:
      containerSize.width -
      gutterDimensions.rowGutterWidth -
      effectiveHeaders.rowHeaderWidth -
      frozenBoundaries.frozenColsWidth,
    height:
      containerSize.height -
      gutterDimensions.colGutterHeight -
      effectiveHeaders.colHeaderHeight -
      frozenBoundaries.frozenRowsHeight,
  };
}

// =============================================================================
// Frozen Boundaries
// =============================================================================

/**
 * Compute pixel boundaries for frozen rows/columns.
 */
function computeFrozenBoundaries(
  config: PersistedViewportConfig,
  positionIndex: ViewportPositionIndex,
): FrozenBoundaries {
  if (config.type !== 'freeze') {
    return { frozenRowsHeight: 0, frozenColsWidth: 0 };
  }

  const frozenRowsHeight = config.rows > 0 ? positionIndex.getRowTop(config.rows) : 0;
  const frozenColsWidth = config.cols > 0 ? positionIndex.getColLeft(config.cols) : 0;

  return { frozenRowsHeight, frozenColsWidth };
}

/**
 * Compute header render info for freeze-aware header rendering.
 *
 * Headers follow the same 4-region structure as viewports when freeze is enabled:
 * - Frozen column headers don't scroll horizontally
 * - Scrolling column headers scroll with scrollPosition.x
 * - Frozen row headers don't scroll vertically
 * - Scrolling row headers scroll with scrollPosition.y
 */
function computeHeaderInfo(
  config: PersistedViewportConfig,
  frozenBoundaries: FrozenBoundaries,
  scrollPosition: Point,
  zoom: number,
): HeaderRenderInfo {
  if (config.type === 'freeze') {
    return {
      frozenRows: config.rows,
      frozenCols: config.cols,
      frozenRowsHeight: frozenBoundaries.frozenRowsHeight,
      frozenColsWidth: frozenBoundaries.frozenColsWidth,
      scrollPosition,
      zoom,
    };
  }

  // Single/split viewport: no frozen regions
  return {
    frozenRows: 0,
    frozenCols: 0,
    frozenRowsHeight: 0,
    frozenColsWidth: 0,
    scrollPosition,
    zoom,
  };
}

// =============================================================================
// Viewport Building
// =============================================================================

interface BuildResult {
  viewports: Viewport[];
  dividers: ViewportDivider[];
  primaryViewportId: string;
}

/**
 * Build viewports based on the persisted configuration type.
 */
function buildViewportsForConfig(
  config: PersistedViewportConfig,
  containerSize: Size,
  positionIndex: ViewportPositionIndex,
  scrollPosition: Point,
  frozenBoundaries: FrozenBoundaries,
  zoom: number,
  gutterDimensions: { rowGutterWidth: number; colGutterHeight: number } = {
    rowGutterWidth: 0,
    colGutterHeight: 0,
  },
  scrollPositions?: Map<string, Point>,
  effectiveHeaders: { rowHeaderWidth: number; colHeaderHeight: number } = {
    rowHeaderWidth: ROW_HEADER_WIDTH,
    colHeaderHeight: COL_HEADER_HEIGHT,
  },
): BuildResult {
  switch (config.type) {
    case 'single':
      return buildSingleViewport(
        containerSize,
        positionIndex,
        scrollPosition,
        zoom,
        gutterDimensions,
        effectiveHeaders,
      );

    case 'freeze':
      return buildFreezeViewports(
        config,
        containerSize,
        positionIndex,
        scrollPosition,
        frozenBoundaries,
        zoom,
        gutterDimensions,
        effectiveHeaders,
      );

    case 'split':
      return buildSplitViewports(
        config,
        containerSize,
        positionIndex,
        scrollPosition,
        zoom,
        gutterDimensions,
        scrollPositions,
        effectiveHeaders,
      );

    default:
      return buildSingleViewport(
        containerSize,
        positionIndex,
        scrollPosition,
        zoom,
        gutterDimensions,
        effectiveHeaders,
      );
  }
}

/**
 * Build a single viewport (no freeze panes).
 */
function buildSingleViewport(
  containerSize: Size,
  positionIndex: ViewportPositionIndex,
  scrollPosition: Point,
  zoom: number,
  gutterDimensions: { rowGutterWidth: number; colGutterHeight: number } = {
    rowGutterWidth: 0,
    colGutterHeight: 0,
  },
  effectiveHeaders: { rowHeaderWidth: number; colHeaderHeight: number } = {
    rowHeaderWidth: ROW_HEADER_WIDTH,
    colHeaderHeight: COL_HEADER_HEIGHT,
  },
): BuildResult {
  const bounds: Rect = {
    x: gutterDimensions.rowGutterWidth + effectiveHeaders.rowHeaderWidth,
    y: gutterDimensions.colGutterHeight + effectiveHeaders.colHeaderHeight,
    width: containerSize.width - gutterDimensions.rowGutterWidth - effectiveHeaders.rowHeaderWidth,
    height:
      containerSize.height - gutterDimensions.colGutterHeight - effectiveHeaders.colHeaderHeight,
  };

  // viewportOrigin = (0, 0); docOrigin = viewportOrigin + scrollOffset = scrollPosition
  const cellRange = computeVisibleRange(
    { width: bounds.width, height: bounds.height },
    scrollPosition,
    positionIndex,
    zoom,
  );

  const viewport: Viewport = {
    id: 'main',
    bounds,
    cellRange,
    viewportOrigin: { x: 0, y: 0 }, // Single viewport: starts at document origin
    scrollOffset: scrollPosition,
    scrollBehavior: { type: 'free' },
    zoom,
    renderConfig: DEFAULT_VIEWPORT_RENDER_CONFIG,
  };

  return {
    viewports: [viewport],
    dividers: [],
    primaryViewportId: 'main',
  };
}

/**
 * Build viewports for freeze pane configuration.
 * Creates 1-4 viewports depending on frozen rows/cols.
 */
function buildFreezeViewports(
  config: FreezeViewportConfig,
  containerSize: Size,
  positionIndex: ViewportPositionIndex,
  scrollPosition: Point,
  frozenBoundaries: FrozenBoundaries,
  zoom: number,
  gutterDimensions: { rowGutterWidth: number; colGutterHeight: number } = {
    rowGutterWidth: 0,
    colGutterHeight: 0,
  },
  effectiveHeaders: { rowHeaderWidth: number; colHeaderHeight: number } = {
    rowHeaderWidth: ROW_HEADER_WIDTH,
    colHeaderHeight: COL_HEADER_HEIGHT,
  },
): BuildResult {
  const { rows: frozenRows, cols: frozenCols } = config;
  const { frozenRowsHeight, frozenColsWidth } = frozenBoundaries;

  // If no freeze, fall back to single viewport
  if (frozenRows === 0 && frozenCols === 0) {
    return buildSingleViewport(
      containerSize,
      positionIndex,
      scrollPosition,
      zoom,
      gutterDimensions,
      effectiveHeaders,
    );
  }

  const viewports: Viewport[] = [];
  const dividers: ViewportDivider[] = [];

  const hasFrozenRows = frozenRows > 0;
  const hasFrozenCols = frozenCols > 0;

  // Content area dimensions (after headers and gutters)
  const contentWidth =
    containerSize.width - gutterDimensions.rowGutterWidth - effectiveHeaders.rowHeaderWidth;
  const contentHeight =
    containerSize.height - gutterDimensions.colGutterHeight - effectiveHeaders.colHeaderHeight;

  // Scaled frozen dimensions, clamped so they never exceed the content area.
  // When frozen rows/cols exceed the viewport (e.g., 68 frozen rows in 804px),
  // the frozen pane fills the available space and the main viewport gets 0 height.
  const scaledFrozenRowsHeight = Math.min(frozenRowsHeight * zoom, Math.max(0, contentHeight));
  const scaledFrozenColsWidth = Math.min(frozenColsWidth * zoom, Math.max(0, contentWidth));

  // 1. Frozen Corner (if both rows and cols are frozen)
  if (hasFrozenRows && hasFrozenCols) {
    const bounds: Rect = {
      x: gutterDimensions.rowGutterWidth + effectiveHeaders.rowHeaderWidth,
      y: gutterDimensions.colGutterHeight + effectiveHeaders.colHeaderHeight,
      width: scaledFrozenColsWidth,
      height: scaledFrozenRowsHeight,
    };

    viewports.push({
      id: 'frozen-corner',
      bounds,
      cellRange: computeFrozenRange(frozenRows - 1, frozenCols - 1),
      viewportOrigin: { x: 0, y: 0 }, // Corner viewport: starts at document origin
      scrollOffset: { x: 0, y: 0 },
      scrollBehavior: { type: 'none' },
      zoom,
      renderConfig: DEFAULT_VIEWPORT_RENDER_CONFIG,
    });
  }

  // 2. Frozen Rows (scrolls horizontally only)
  if (hasFrozenRows) {
    const bounds: Rect = {
      x: hasFrozenCols
        ? gutterDimensions.rowGutterWidth + effectiveHeaders.rowHeaderWidth + scaledFrozenColsWidth
        : gutterDimensions.rowGutterWidth + effectiveHeaders.rowHeaderWidth,
      y: gutterDimensions.colGutterHeight + effectiveHeaders.colHeaderHeight,
      width: hasFrozenCols ? contentWidth - scaledFrozenColsWidth : contentWidth,
      height: scaledFrozenRowsHeight,
    };

    // viewportOrigin = (frozenColsWidth-or-0, 0); scrollOffset = (scrollPosition.x, 0).
    // docOrigin = viewportOrigin + scrollOffset.
    const frozenRowsViewportOriginX = hasFrozenCols ? frozenColsWidth : 0;
    const cellRange = computeVisibleRange(
      { width: bounds.width, height: bounds.height },
      { x: frozenRowsViewportOriginX + scrollPosition.x, y: 0 },
      positionIndex,
      zoom,
    );

    viewports.push({
      id: 'frozen-rows',
      bounds,
      cellRange,
      // Frozen rows viewport: starts after frozen columns horizontally, at top vertically
      viewportOrigin: { x: frozenRowsViewportOriginX, y: 0 },
      scrollOffset: { x: scrollPosition.x, y: 0 },
      scrollBehavior: { type: 'horizontal-only' },
      zoom,
      renderConfig: DEFAULT_VIEWPORT_RENDER_CONFIG,
    });

    // Add horizontal divider below frozen rows
    dividers.push({
      type: 'freeze',
      orientation: 'horizontal',
      position:
        gutterDimensions.colGutterHeight +
        effectiveHeaders.colHeaderHeight +
        scaledFrozenRowsHeight,
      draggable: false,
    });
  }

  // 3. Frozen Columns (scrolls vertically only)
  if (hasFrozenCols) {
    const bounds: Rect = {
      x: gutterDimensions.rowGutterWidth + effectiveHeaders.rowHeaderWidth,
      y: hasFrozenRows
        ? gutterDimensions.colGutterHeight +
          effectiveHeaders.colHeaderHeight +
          scaledFrozenRowsHeight
        : gutterDimensions.colGutterHeight + effectiveHeaders.colHeaderHeight,
      width: scaledFrozenColsWidth,
      height: hasFrozenRows ? contentHeight - scaledFrozenRowsHeight : contentHeight,
    };

    // viewportOrigin = (0, frozenRowsHeight-or-0); scrollOffset = (0, scrollPosition.y).
    // docOrigin = viewportOrigin + scrollOffset.
    const frozenColsViewportOriginY = hasFrozenRows ? frozenRowsHeight : 0;
    const cellRange = computeVisibleRange(
      { width: bounds.width, height: bounds.height },
      { x: 0, y: frozenColsViewportOriginY + scrollPosition.y },
      positionIndex,
      zoom,
    );

    viewports.push({
      id: 'frozen-cols',
      bounds,
      cellRange,
      // Frozen cols viewport: starts at left horizontally, after frozen rows vertically
      viewportOrigin: { x: 0, y: frozenColsViewportOriginY },
      scrollOffset: { x: 0, y: scrollPosition.y },
      scrollBehavior: { type: 'vertical-only' },
      zoom,
      renderConfig: DEFAULT_VIEWPORT_RENDER_CONFIG,
    });

    // Add vertical divider to the right of frozen cols
    dividers.push({
      type: 'freeze',
      orientation: 'vertical',
      position:
        gutterDimensions.rowGutterWidth + effectiveHeaders.rowHeaderWidth + scaledFrozenColsWidth,
      draggable: false,
    });
  }

  // 4. Main scrollable area
  const mainBounds: Rect = {
    x: hasFrozenCols
      ? gutterDimensions.rowGutterWidth + effectiveHeaders.rowHeaderWidth + scaledFrozenColsWidth
      : gutterDimensions.rowGutterWidth + effectiveHeaders.rowHeaderWidth,
    y: hasFrozenRows
      ? gutterDimensions.colGutterHeight + effectiveHeaders.colHeaderHeight + scaledFrozenRowsHeight
      : gutterDimensions.colGutterHeight + effectiveHeaders.colHeaderHeight,
    width: hasFrozenCols ? contentWidth - scaledFrozenColsWidth : contentWidth,
    height: hasFrozenRows ? contentHeight - scaledFrozenRowsHeight : contentHeight,
  };

  // Main viewport: viewportOrigin = (frozenColsWidth-or-0, frozenRowsHeight-or-0);
  // scrollOffset = scrollPosition. docOrigin = viewportOrigin + scrollOffset.
  const mainViewportOrigin = {
    x: hasFrozenCols ? frozenColsWidth : 0,
    y: hasFrozenRows ? frozenRowsHeight : 0,
  };
  const mainCellRange = computeVisibleRange(
    { width: mainBounds.width, height: mainBounds.height },
    {
      x: mainViewportOrigin.x + scrollPosition.x,
      y: mainViewportOrigin.y + scrollPosition.y,
    },
    positionIndex,
    zoom,
  );

  viewports.push({
    id: 'main',
    bounds: mainBounds,
    cellRange: mainCellRange,
    // Main viewport: starts after both frozen columns and frozen rows
    viewportOrigin: mainViewportOrigin,
    scrollOffset: scrollPosition,
    scrollBehavior: { type: 'free' },
    zoom,
    renderConfig: DEFAULT_VIEWPORT_RENDER_CONFIG,
  });

  return {
    viewports,
    dividers,
    primaryViewportId: 'main',
  };
}

/**
 * Build viewports for split view configuration.
 * Creates 2 or 4 independently scrolling viewports.
 *
 * Split view differs from freeze panes:
 * - Each pane scrolls independently (freeze panes share scroll position)
 * - Split dividers are draggable (freeze dividers are fixed)
 * - All panes can scroll to any content (frozen panes only show frozen rows/cols)
 *
 * Viewport IDs:
 * - Horizontal split: 'top', 'bottom'
 * - Vertical split: 'left', 'right'
 * - Both (4 quadrants): 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'
 */
function buildSplitViewports(
  config: SplitViewportConfig,
  containerSize: Size,
  positionIndex: ViewportPositionIndex,
  defaultScrollPosition: Point,
  zoom: number,
  gutterDimensions: { rowGutterWidth: number; colGutterHeight: number } = {
    rowGutterWidth: 0,
    colGutterHeight: 0,
  },
  scrollPositions?: Map<string, Point>,
  effectiveHeaders: { rowHeaderWidth: number; colHeaderHeight: number } = {
    rowHeaderWidth: ROW_HEADER_WIDTH,
    colHeaderHeight: COL_HEADER_HEIGHT,
  },
): BuildResult {
  const { direction, horizontalPosition, verticalPosition } = config;

  // Content area dimensions (after headers and gutters)
  const contentX = gutterDimensions.rowGutterWidth + effectiveHeaders.rowHeaderWidth;
  const contentY = gutterDimensions.colGutterHeight + effectiveHeaders.colHeaderHeight;
  const contentWidth = containerSize.width - contentX;
  const contentHeight = containerSize.height - contentY;

  // Compute split line positions in pixels
  const splitRowPixels =
    direction === 'vertical' ? 0 : positionIndex.getRowTop(horizontalPosition) * zoom;
  const splitColPixels =
    direction === 'horizontal' ? 0 : positionIndex.getColLeft(verticalPosition) * zoom;

  // Ensure split positions don't exceed content area (leave at least 50px for each pane)
  const minPaneSize = 50;
  const clampedSplitRowPixels = Math.max(
    minPaneSize,
    Math.min(splitRowPixels, contentHeight - minPaneSize),
  );
  const clampedSplitColPixels = Math.max(
    minPaneSize,
    Math.min(splitColPixels, contentWidth - minPaneSize),
  );

  const viewports: Viewport[] = [];
  const dividers: ViewportDivider[] = [];

  /**
   * Get scroll position for a viewport.
   * Uses per-viewport positions if provided, otherwise falls back to default.
   */
  function getScrollPositionForViewport(viewportId: string): Point {
    if (scrollPositions?.has(viewportId)) {
      return scrollPositions.get(viewportId)!;
    }
    return defaultScrollPosition;
  }

  switch (direction) {
    case 'horizontal':
      // Two viewports: top and bottom
      viewports.push(
        buildSplitPane(
          'top',
          {
            x: contentX,
            y: contentY,
            width: contentWidth,
            height: clampedSplitRowPixels,
          },
          getScrollPositionForViewport('top'),
          positionIndex,
          zoom,
        ),
        buildSplitPane(
          'bottom',
          {
            x: contentX,
            y: contentY + clampedSplitRowPixels,
            width: contentWidth,
            height: contentHeight - clampedSplitRowPixels,
          },
          getScrollPositionForViewport('bottom'),
          positionIndex,
          zoom,
        ),
      );

      // Add horizontal divider
      dividers.push({
        type: 'split',
        orientation: 'horizontal',
        position: contentY + clampedSplitRowPixels,
        draggable: true,
      });
      break;

    case 'vertical':
      // Two viewports: left and right
      viewports.push(
        buildSplitPane(
          'left',
          {
            x: contentX,
            y: contentY,
            width: clampedSplitColPixels,
            height: contentHeight,
          },
          getScrollPositionForViewport('left'),
          positionIndex,
          zoom,
        ),
        buildSplitPane(
          'right',
          {
            x: contentX + clampedSplitColPixels,
            y: contentY,
            width: contentWidth - clampedSplitColPixels,
            height: contentHeight,
          },
          getScrollPositionForViewport('right'),
          positionIndex,
          zoom,
        ),
      );

      // Add vertical divider
      dividers.push({
        type: 'split',
        orientation: 'vertical',
        position: contentX + clampedSplitColPixels,
        draggable: true,
      });
      break;

    case 'both':
      // Four viewports: quadrants
      viewports.push(
        buildSplitPane(
          'topLeft',
          {
            x: contentX,
            y: contentY,
            width: clampedSplitColPixels,
            height: clampedSplitRowPixels,
          },
          getScrollPositionForViewport('topLeft'),
          positionIndex,
          zoom,
        ),
        buildSplitPane(
          'topRight',
          {
            x: contentX + clampedSplitColPixels,
            y: contentY,
            width: contentWidth - clampedSplitColPixels,
            height: clampedSplitRowPixels,
          },
          getScrollPositionForViewport('topRight'),
          positionIndex,
          zoom,
        ),
        buildSplitPane(
          'bottomLeft',
          {
            x: contentX,
            y: contentY + clampedSplitRowPixels,
            width: clampedSplitColPixels,
            height: contentHeight - clampedSplitRowPixels,
          },
          getScrollPositionForViewport('bottomLeft'),
          positionIndex,
          zoom,
        ),
        buildSplitPane(
          'bottomRight',
          {
            x: contentX + clampedSplitColPixels,
            y: contentY + clampedSplitRowPixels,
            width: contentWidth - clampedSplitColPixels,
            height: contentHeight - clampedSplitRowPixels,
          },
          getScrollPositionForViewport('bottomRight'),
          positionIndex,
          zoom,
        ),
      );

      // Add both dividers
      dividers.push(
        {
          type: 'split',
          orientation: 'horizontal',
          position: contentY + clampedSplitRowPixels,
          draggable: true,
        },
        {
          type: 'split',
          orientation: 'vertical',
          position: contentX + clampedSplitColPixels,
          draggable: true,
        },
      );
      break;
  }

  // Primary viewport is the first one in the list
  // In split view, all viewports are equally primary - this is just for compatibility
  const primaryViewportId = viewports[0]?.id ?? 'main';

  return {
    viewports,
    dividers,
    primaryViewportId,
  };
}

/**
 * Build a single split pane viewport.
 * Helper function for buildSplitViewports.
 */
function buildSplitPane(
  id: string,
  bounds: Rect,
  scrollPosition: Point,
  positionIndex: ViewportPositionIndex,
  zoom: number,
): Viewport {
  // Split panes: viewportOrigin = (0, 0); docOrigin = scrollPosition.
  const cellRange = computeVisibleRange(
    { width: bounds.width, height: bounds.height },
    scrollPosition,
    positionIndex,
    zoom,
  );

  return {
    id,
    bounds,
    cellRange,
    viewportOrigin: { x: 0, y: 0 }, // Split panes all start at document origin
    scrollOffset: scrollPosition,
    scrollBehavior: { type: 'free' }, // All split panes scroll freely
    zoom,
    renderConfig: DEFAULT_VIEWPORT_RENDER_CONFIG,
  };
}

// =============================================================================
// Overlay Viewports
// =============================================================================

/**
 * Build overlay viewports from session-local configurations.
 */
function buildOverlayViewports(overlays: OverlayViewportConfig[], zoom: number): Viewport[] {
  return overlays.map((overlay) => {
    // Determine cell range based on content type
    let cellRange: CellRange;
    let overlaySheetId: string | undefined;

    switch (overlay.content.type) {
      case 'range':
        cellRange = overlay.content.range;
        overlaySheetId = overlay.content.sheetId;
        break;
      case 'cell':
        cellRange = {
          startRow: overlay.content.row,
          startCol: overlay.content.col,
          endRow: overlay.content.row,
          endCol: overlay.content.col,
        };
        overlaySheetId = overlay.content.sheetId;
        break;
      case 'custom':
        // Custom renderers define their own cell range
        cellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
        break;
    }

    const overlayRenderConfig: ViewportRenderConfig = {
      ...DEFAULT_VIEWPORT_RENDER_CONFIG,
      showGridLines: true,
      backgroundColor: '#ffffff',
      border: { color: '#217346', width: 2 },
      opacity: 1,
    };

    return {
      id: overlay.id,
      bounds: overlay.bounds,
      cellRange,
      viewportOrigin: { x: 0, y: 0 }, // Overlay viewports: no coordinate offset
      scrollOffset: { x: 0, y: 0 },
      scrollBehavior: { type: 'none' },
      sheetId: overlaySheetId,
      zoom,
      renderConfig: overlayRenderConfig,
    };
  });
}
