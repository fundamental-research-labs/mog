# Renderer Coordinate System

## Overview

The `CoordinateSystem` contract is the public type boundary for document, viewport, and layer conversions. `CoordinateSystemImpl` is the workspace-internal implementation exposed through `GridRenderer.getCoordinateSystem()` and SheetView geometry helpers.

It is not the only coordinate math in the renderer. Current hot paths also use `GridCoordinateSystem` for grid cell/document lookups, `ViewportLayout` for split/freeze viewport geometry, and `canvasToDocXY`/`docToCanvasXY` helpers for viewport transforms. New coordinate work should use one of these code-backed helpers instead of ad hoc math.

## Type-Safe Coordinate Spaces (Branded Types)

We use **branded types** to prevent coordinate space bugs at compile time. The branded types have **zero runtime overhead** - they're purely compile-time checks.

```typescript
// These are incompatible at the type level - prevents bugs!
type DocumentPoint = Point & { readonly [DocumentBrand]: true };
type ViewportPoint = Point & { readonly [ViewportBrand]: true };
type LayerPoint = Point & { readonly [LayerBrand]: true };
```

The shipped public `@mog-sdk/contracts` package exposes the branded types; its `./rendering` and `./rendering/coordinates` subpaths are marked `public-experimental` in `tools/package-inventory.jsonc`. Factory helpers currently live in the private `@mog/spreadsheet-utils` workspace package; use that import inside this monorepo, but do not present it as an external integration path.

```typescript
import type {
  DocumentPoint,
  DocumentRect,
  ViewportPoint,
  ViewportRect,
  LayerPoint,
  LayerRect
} from '@mog-sdk/contracts/rendering';

import {
  documentPoint,
  documentRect,
  viewportPoint,
  viewportRect,
  layerPoint,
  layerRect
} from '@mog/spreadsheet-utils/rendering/coordinates';
```

## Coordinate Spaces

| Space        | Types                           | Origin             | Units                  | Headers                                | Use Cases                                   |
| ------------ | ------------------------------- | ------------------ | ---------------------- | -------------------------------------- | ------------------------------------------- |
| **Cell**     | `CellCoord`                     | N/A                | Logical `{row, col}`   | N/A                                    | Cell references, selection                  |
| **Document** | `DocumentPoint`, `DocumentRect` | Cell A1            | Unzoomed pixels        | N/A                                    | Storage, formulas, object bounds            |
| **Viewport** | `ViewportPoint`, `ViewportRect` | Canvas top-left    | Screen pixels (zoomed) | Includes effective cell-area offset    | Mouse events, input handling                |
| **Layer**    | `LayerPoint`, `LayerRect`       | Cell area top-left | Screen pixels (zoomed) | No headers or gutters                  | Render layers, region-local geometry        |
| **Canvas**   | N/A                             | Canvas top-left    | Device pixels          | N/A                                    | Final drawing (viewport × devicePixelRatio) |

### Visual Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Canvas (Viewport Space origin = 0,0)                            │
│ ┌──────────┬───────────────────────────────────────────────────┐│
│ │ Select   │  Column Headers (24px)                           ││
│ │ All      │  A      B      C      D      E                   ││
│ ├──────────┼───────────────────────────────────────────────────┤│
│ │ Row      │ ┌──────────────────────────────────────────────┐ ││
│ │ Headers  │ │ Cell Area (Layer Space origin = 0,0)         │ ││
│ │ (50px)   │ │                                              │ ││
│ │ 1        │ │  Render layers draw here after ctx.translate │ ││
│ │ 2        │ │  Region-local geometry uses this space       │ ││
│ │ 3        │ │                                              │ ││
│ └──────────┴─┴──────────────────────────────────────────────┴─┘│
└─────────────────────────────────────────────────────────────────┘

Key insight:
- Viewport = Layer + cell-area offset
- With default visible headers and no outline gutters, that offset is 50px, 24px
- viewportToLayer(vp) = layerPoint(vp.x - cellAreaLeft, vp.y - cellAreaTop)
```

### Why Layer Space?

Render layers operate after the canvas is translated to the current cell area. If a layer consumer expects layer-relative coordinates, passing viewport coordinates adds the header/gutter offset twice.

**The Bug (before branded types):**

```typescript
// Overlay layer renders at (100, 100) in layer space
ctx.fillRect(100, 100, 50, 50);

// Click handler receives viewport coords (150, 124)
// BUG: Passed directly to a layer-space consumer - offset is still included.
const vp = viewportPoint(150, 124);
selectLayerElement(vp);
```

**The Fix (with branded types):**

```typescript
// TypeScript ERROR: ViewportPoint not assignable to LayerPoint
selectLayerElement(vp);

// CORRECT: Convert first
const layerPt = coords.viewportToLayer(vp);
selectLayerElement(layerPt); // Now coordinates match.
```

## Core Interface

**Interface:** `@mog-sdk/contracts/rendering` - `public-experimental` subpath of shipped public `@mog-sdk/contracts`
**Source:** `types/rendering/src/coordinates.ts`
**Implementation:** `canvas/grid-renderer/src/coordinates/coordinate-system.ts` (`CoordinateSystemImpl`, workspace-internal `@mog/grid-renderer`)
**Factory helpers:** `spreadsheet-utils/src/rendering/coordinates.ts` (workspace-internal `@mog/spreadsheet-utils`)

> **Note:** `contracts/src/rendering/coordinates.ts` is a re-export shim for `@mog-sdk/contracts`. The `canvas/grid-renderer/src/coordinates/types.ts` file re-exports the renderer-facing subset.

```typescript
export interface CoordinateSystem {
  // Cell <-> Document conversions (return branded DocumentRect)
  cellToDocument(sheetId: string, cell: CellCoord): DocumentRect;
  documentToCell(sheetId: string, point: DocumentPoint): CellCoord | null;
  rangeToDocument(sheetId: string, range: CellRange): DocumentRect;

  // Document <-> Viewport conversions (branded types)
  documentToViewport(sheetId: string, rect: DocumentRect): ViewportRect | null;
  documentToLayerViewport(sheetId: string, rect: DocumentRect): LayerRect | null;
  viewportToDocument(sheetId: string, point: ViewportPoint): DocumentPoint;

  // Viewport <-> Layer conversions (header offset handling)
  viewportToLayer(point: ViewportPoint): LayerPoint;
  layerToViewport(point: LayerPoint): ViewportPoint;

  // Cell <-> Viewport (convenience, branded returns)
  cellToViewport(sheetId: string, cell: CellCoord): ViewportRect | null;
  viewportToCell(sheetId: string, point: ViewportPoint): CellCoord | null;
  rangeToViewport(sheetId: string, range: CellRange): ViewportRect[];

  // Click position (accounts for frozen panes, zoom, headers)
  getClickPositionInCell(sheetId: string, point: ViewportPoint, cell: CellCoord):
    { x: number; y: number; width: number; height: number } | null;

  // Hit Testing (expects ViewportPoint from mouse events)
  classifyPoint(sheetId: string, point: ViewportPoint, isTouch?: boolean): HitTestResult;

  // Viewport queries
  getVisibleRange(sheetId: string): CellRange;
  getVisibleRegions(sheetId: string): VisibleRegions;
  isCellVisible(sheetId: string, cell: CellCoord): boolean;
  isCellFrozen(sheetId: string, cell: CellCoord): boolean;

  // Scrolling
  getScrollToCell(sheetId: string, cell: CellCoord, padding?: number):
    { top: number; left: number } | null;
  getScrollBounds(sheetId: string): { maxScrollTop: number; maxScrollLeft: number };
  getViewportBounds(sheetId: string): { left: number; top: number; right: number; bottom: number };

  // Configuration
  setViewport(viewport: ScrollViewport): void;
  getViewport(): ScrollViewport;
  setFrozenPanes(panes: FrozenPanes): void;
  getFrozenPanes(): FrozenPanes;
  setZoom(zoom: number): void;
  getZoom(): number;
  getDevicePixelRatio(): number;
  getCurrentSheetId(): string | null;

  // Position & Merge Indexes (replace legacy DimensionProvider)
  setViewportPositionIndex(index: ViewportPositionIndexLike | null): void;
  getViewportPositionIndex(): ViewportPositionIndexLike | null;
  getPositionIndex(): ViewportPositionIndexLike | null;
  setViewportMergeIndex(index: ViewportMergeIndexLike | null): void;
  getViewportMergeIndex(): ViewportMergeIndexLike | null;

  // Outline gutters and header visibility
  setOutlineGutter(rowGutterWidth: number, colGutterHeight: number): void;
  getOutlineGutter(): { rowGutterWidth: number; colGutterHeight: number };
  setHeaderVisibility(visibility: HeaderVisibility): void;
  getHeaderVisibility(): HeaderVisibility;
}
```

> **Note:** Most conversion methods take a `sheetId` parameter. Methods that operate purely in viewport/layer space (like `viewportToLayer`) do not need it. `CoordinateSystemImpl` itself does not track the active sheet; `getCurrentSheetId()` currently returns `null`, so callers must pass the sheet ID they are rendering.

> **Current limitation:** `rangeToViewport()` has an array return type for split/freeze-aware callers, but `CoordinateSystemImpl` currently computes one bounding `ViewportRect` and returns either `[rect]` or `[]`.

## Creating Branded Coordinates

At boundaries where you know the coordinate space, use factory functions:

```typescript
import { documentRect, viewportPoint } from '@mog/spreadsheet-utils/rendering/coordinates';

// From mouse event (viewport space)
function handleClick(sheetId: string, event: MouseEvent) {
  const vp = viewportPoint(event.offsetX, event.offsetY);
  const hit = coords.classifyPoint(sheetId, vp);
}

// From storage (document space)
const docBounds = documentRect(object.x, object.y, object.width, object.height);

// Converting for render layers
const layerBounds = coords.documentToLayerViewport(sheetId, docBounds);
```

## Common Patterns

### Mouse Event → Hit Test → Storage

```typescript
function handleMouseDown(sheetId: string, event: MouseEvent, renderer: GridRenderer) {
  // 1. Mouse events are in viewport space
  const vp = viewportPoint(event.offsetX, event.offsetY);
  const coords = renderer.getCoordinateSystem();

  // 2. Unified renderer hit testing expects viewport coords
  const hit = renderer.hitTest(vp.x, vp.y);

  // 3. Convert to document for storage operations
  const doc = coords.viewportToDocument(sheetId, vp);
  const cell = coords.documentToCell(sheetId, doc);
}
```

### Rendering Layer Geometry

```typescript
function renderLayerObject(sheetId: string, object: FloatingObject, ctx: RenderContext) {
  // 1. Object bounds stored in document space
  const docBounds = documentRect(object.x, object.y, object.width, object.height);

  // 2. Convert to layer space (NOT viewport - ctx.translate handles headers)
  const layerBounds = ctx.coords.documentToLayerViewport(sheetId, docBounds);
  if (!layerBounds) return; // Not visible

  // 3. Draw in layer space
  ctx.fillRect(layerBounds.x, layerBounds.y, layerBounds.width, layerBounds.height);
}
```

### Unified Hit Testing

```typescript
function queryPointer(vpPoint: ViewportPoint, renderer: GridRenderer) {
  // GridRenderer.hitTest asks the canvas engine first. Overlay and drawing hits
  // become floatingObject results; grid/header fallback uses classifyPoint().
  return renderer.hitTest(vpPoint.x, vpPoint.y);
}
```

## Position & Merge Indexes

The old broad `DimensionProvider` pattern has been replaced on the hot render path by two specialized index classes. SheetView populates them from `ViewportReader` data in `views/sheet-view/src/viewport-wiring.ts`, then the renderer, scheduler, layers, and `CoordinateSystemImpl` consume them.

### ViewportPositionIndex

**File:** `canvas/grid-renderer/src/coordinates/viewport-position-index.ts`

Provides O(1) position lookups for the canvas renderer's hot path. Backed by `Float64Array` data from the `BinaryViewportBuffer`. Falls back to default-based estimates for indices outside the prefetch range.

```typescript
class ViewportPositionIndex {
  setPositions(rowPositions: Float64Array | null, colPositions: Float64Array | null,
               startRow: number, startCol: number,
               rowCount?: number, colCount?: number,
               defaultRowHeight?: number, defaultColWidth?: number): void;
  setHiddenState(hiddenRows: Set<number>, hiddenCols: Set<number>): void;
  setTotalDimensions(totalRows: number, totalCols: number): void;

  getRowTop(row: number): number;   // O(1) pixel position of row's top edge
  getColLeft(col: number): number;  // O(1) pixel position of column's left edge
  getRowHeight(row: number): number;
  getColWidth(col: number): number;
  isRowHidden(row: number): boolean;
  isColHidden(col: number): boolean;
  findRowAtY(y: number): number | null;  // Binary search
  findColAtX(x: number): number | null;  // Binary search
  get hasData(): boolean;
  get totalRows(): number;
  get totalCols(): number;
}
```

### ViewportMergeIndex

**File:** `canvas/grid-renderer/src/coordinates/viewport-merge-index.ts`

Provides O(1) merge point-queries. Uses a flat `Map<number, MergeRegion>` keyed by `row * MAX_COLS + col`. Every cell coordinate within a merge points to the same `MergeRegion` object, trading memory for constant-time lookup with zero string allocation.

```typescript
class ViewportMergeIndex {
  setMerges(merges: BinaryMergeInput[]): void;
  getMergedRegion(row: number, col: number): MergeRegion | null;
  getMerges(): readonly MergeRegion[];
  clear(): void;
  get hasMerges(): boolean;
  get mergeCount(): number;
}
```

The `CoordinateSystem` consumes these via minimal public interfaces (`ViewportPositionIndexLike`, `ViewportMergeIndexLike`) defined in `@mog-sdk/contracts/rendering`. Those interfaces include lookup, hidden-state, and total-dimension reads, not the population methods.

## Frozen Panes

When frozen panes are enabled, the viewport is divided into up to 4 regions:

```typescript
interface VisibleRegions {
  frozenCorner: CellRange | null; // Top-left (always visible)
  frozenRows: CellRange | null; // Scrolls horizontally only
  frozenCols: CellRange | null; // Scrolls vertically only
  main: CellRange; // Main scrollable area
}
```

**Conversion rules:**

- Frozen cells do not subtract scroll; viewport coords still apply zoom and the effective cell-area offset.
- Non-frozen cells subtract scroll, then apply zoom and the effective cell-area offset. Frozen row/column widths remain part of document-space positions.

## Hit Testing

**File:** `canvas/grid-renderer/src/coordinates/coordinate-system.ts`

`GridRenderer.hitTest(x, y)` is the public renderer hit-test entry point. The current implementation asks the canvas engine for topmost hits, maps overlay and drawing hits to `floatingObject`, and otherwise falls back to `CoordinateSystem.classifyPoint()` for grid/header classification:

```typescript
classifyPoint(sheetId: string, point: ViewportPoint, isTouch = false): HitTestResult {
  // Returns one of:
  // - { type: 'cell', row, col }
  // - { type: 'columnHeader', col }
  // - { type: 'rowHeader', row }
  // - { type: 'columnResize', col }
  // - { type: 'rowResize', row }
  // - { type: 'hiddenColumnBoundary', col, hiddenStart, hiddenEnd }
  // - { type: 'hiddenRowBoundary', row, hiddenStart, hiddenEnd }
  // - { type: 'outlineGutter', orientation }
  // - { type: 'frozen', region: 'topLeft' }
  // - { type: 'empty' }
}
```

**Touch-aware hit areas:** When `isTouch` is true, resize and hidden-boundary tolerances expand from 5px to 22px on each side, matching the code comment's 44px target-size reference.

## Helper Functions

**File:** `canvas/grid-renderer/src/coordinates/coordinate-system.ts`

### Selection Border Hit Testing

```typescript
/**
 * Check if a point is on the selection border (within tolerance).
 * Excludes fill handle area (bottom-right corner).
 */
function isOnSelectionBorder(point: Point, selectionRect: Rect, tolerance: number = 5): boolean;
```

### Fill Handle Hit Testing

```typescript
/**
 * Check if a point is on the fill handle (bottom-right corner of selection).
 * Used for drag-fill formulas and values.
 */
function isOnFillHandle(point: Point, selectionRect: Rect, handleSize: number = 8): boolean;
```

### Table Resize Handle Hit Testing

```typescript
/**
 * Check if a point is on the table resize handle (blue triangle at bottom-right).
 */
function isOnTableResizeHandle(point: Point, tableRect: Rect, handleSize: number = 10): boolean;
```

### Factory Function

```typescript
/**
 * Create a new coordinate system instance.
 */
function createCoordinateSystem(): CoordinateSystemImpl;
```

## Key Implementation Details

### Binary Search for Hit Testing

Cell lookup uses binary search for O(log n) performance:

```typescript
documentToCell(sheetId: string, point: DocumentPoint): CellCoord | null {
  const row = this.binarySearchRow(sheetId, point.y);
  if (row === null) return null;

  const col = this.binarySearchCol(sheetId, point.x);
  if (col === null) return null;

  // Check for merged regions
  const merged = this.mergeIndex?.getMergedRegion(row, col);
  return merged ? { row: merged.startRow, col: merged.startCol } : { row, col };
}
```

### Zoom Handling

Zoom is applied to viewport coordinates:

```typescript
documentToViewport(sheetId: string, rect: DocumentRect): ViewportRect | null {
  // ... calculate viewport position ...
  const cellAreaLeft = this.getCellAreaLeft();
  const cellAreaTop = this.getCellAreaTop();

  return {
    x: viewportX * this.zoom + cellAreaLeft,
    y: viewportY * this.zoom + cellAreaTop,
    width: rect.width * this.zoom,
    height: rect.height * this.zoom,
  };
}
```

### Scroll-to-Cell

Calculates scroll offset to bring a cell into view:

```typescript
getScrollToCell(sheetId: string, cell: CellCoord, padding: number = 20):
  { top: number; left: number } | null {
  if (this.isCellFrozen(sheetId, cell)) return null; // Frozen = always visible

  const cellRect = this.cellToDocument(sheetId, cell);
  // Calculate if cell is outside visible bounds
  // Return new scroll position or null if already visible
}
```

### Viewport Bounds for Auto-Scroll

```typescript
getViewportBounds(sheetId: string): { left: number; top: number; right: number; bottom: number } {
  // Returns the scrollable region boundaries, excluding frozen panes and headers.
  // Used by auto-scroll service during drag operations.
}
```

## Usage Examples

### Rendering (virtualized cells)

```typescript
function renderVisibleCells(sheetId: string, ctx: CanvasRenderingContext2D, coords: CoordinateSystem) {
  const regions = coords.getVisibleRegions(sheetId);

  if (regions.frozenCorner) renderRegion(ctx, coords, regions.frozenCorner);
  if (regions.frozenRows) renderRegion(ctx, coords, regions.frozenRows);
  if (regions.frozenCols) renderRegion(ctx, coords, regions.frozenCols);
  renderRegion(ctx, coords, regions.main);
}
```

### Hit Testing (mouse clicks)

```typescript
function handleMouseDown(sheetId: string, e: MouseEvent, coords: CoordinateSystem) {
  const cell = coords.viewportToCell(sheetId, viewportPoint(e.offsetX, e.offsetY));
  if (cell) {
    selectionActor.send({ type: 'MOUSE_DOWN', cell, ... });
  }
}
```

### Keyboard Navigation

```typescript
function handleArrowKey(sheetId: string, direction: Direction, selection: Selection, coords: CoordinateSystem) {
  const newActiveCell = moveCell(selection.activeCell, direction);
  const scrollTo = coords.getScrollToCell(sheetId, newActiveCell);

  if (scrollTo) {
    rendererActor.send({ type: 'SCROLL_TO', ...scrollTo });
  }
}
```

## Viewports Subdirectory

**Locations:** `canvas/grid-renderer/src/viewports/` for shared viewport math and `canvas/grid-canvas/src/viewports/` for layout computation.

The viewports modules provide higher-level viewport management alongside `CoordinateSystemImpl`. They use `ViewportPositionIndex`, contract viewport types, and canvas transform helpers to compute split/freeze layouts and layout hit tests.

### Core Files

| File                                                       | Description                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `canvas/grid-renderer/src/viewports/viewport.ts`           | Legacy virtual scrolling calculations and viewport estimates           |
| `canvas/grid-canvas/src/viewports/compute-layout.ts`       | Pure function to compute complete `ViewportLayout` from inputs         |
| `canvas/grid-canvas/src/viewports/scroll.ts`               | Scroll clamping and max-scroll helpers used by layout computation      |
| `canvas/grid-renderer/src/layout/compute-visible-range.ts` | Compute which cells are visible, properly excluding hidden rows/cols   |
| `canvas/grid-renderer/src/viewports/hit-testing.ts`        | Hit testing against `ViewportLayout` with divider and viewport checks  |
| `canvas/grid-renderer/src/viewports/scroll.ts`             | Scroll behavior computation, clamping, and scroll-to-cell              |
| `canvas/grid-renderer/src/viewports/types.ts`              | Renderer viewport type re-exports plus internal compute input types    |

### Viewport Layout Structure

The `computeViewportLayout()` function returns:

```typescript
interface ViewportLayout {
  readonly viewports: readonly Viewport[]; // All viewports in z-order
  readonly primaryViewportId: string; // Keyboard/scroll target viewport
  readonly dividers: readonly ViewportDivider[]; // Freeze lines or split bars
  readonly contentSize: Size; // Total content dimensions
  readonly maxScroll: Point; // Maximum scroll position
  readonly headerInfo: HeaderRenderInfo; // Freeze-aware header rendering info
}
```

### Freeze Pane Viewports

```
Layout with both frozen rows and cols:
+-------------+-------------------------+
|   corner    |     frozen-rows         |
| (no scroll) | (horizontal scroll only)|
+-------------+-------------------------+
| frozen-cols |        main             |
| (vertical   |   (full scroll)         |
|  scroll)    |                         |
+-------------+-------------------------+
```

Viewport IDs:

- `frozen-corner` - Top-left intersection (no scroll)
- `frozen-rows` - Top row (horizontal scroll only)
- `frozen-cols` - Left column (vertical scroll only)
- `main` - Main scrollable area

### Scroll Behaviors

```typescript
type ScrollBehavior =
  | { type: 'free' } // Full scroll (main viewport)
  | { type: 'horizontal-only' } // Frozen rows
  | { type: 'vertical-only' } // Frozen columns
  | { type: 'none' } // Frozen corner
  | { type: 'linked'; viewportId: string; axis: 'x' | 'y' }; // Follow another viewport
```

### Layout Hit Testing

```typescript
// Hit test against complete layout
const result = hitTestLayout(layout, point, positionIndex, mergeIndex);

// Result types:
// - { type: 'viewport', viewport, cell, localPoint }
// - { type: 'divider', divider, index }
// - { type: 'empty' }
```

## File Structure

```
canvas/grid-renderer/src/coordinates/
+-- types.ts                      # Re-exports from @mog-sdk/contracts
+-- coordinate-system.ts          # CoordinateSystemImpl
+-- viewport-position-index.ts    # O(1) position lookups from binary buffer
+-- viewport-merge-index.ts       # O(1) merge lookups from binary buffer
+-- index.ts                      # Workspace package exports

canvas/grid-renderer/src/viewports/
+-- types.ts                      # Viewport, ViewportLayout, ScrollBehavior
+-- viewport.ts                   # Viewport calculations, pixelToCell
+-- hit-testing.ts                # Layout hit testing
+-- scroll.ts                     # Scroll behavior and clamping
+-- index.ts                      # Workspace package exports

canvas/grid-renderer/src/layout/
+-- compute-visible-range.ts      # Visible cell range calculation

canvas/grid-canvas/src/viewports/
+-- compute-layout.ts             # ViewportLayout computation
+-- scroll.ts                     # Layout scroll clamping and max-scroll helpers
+-- types.ts                      # grid-canvas viewport type shim
+-- index.ts                      # Workspace package exports
```
