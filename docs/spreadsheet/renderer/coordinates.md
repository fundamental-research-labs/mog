# Renderer Coordinate System

## Overview

The CoordinateSystem is the **single source of truth for all coordinate conversions**. Without a central service, each component implements its own math, creating bugs across selection, rendering, scrolling, and hit testing.

## Type-Safe Coordinate Spaces (Branded Types)

We use **branded types** to prevent coordinate space bugs at compile time. The branded types have **zero runtime overhead** - they're purely compile-time checks.

```typescript
// These are incompatible at the type level - prevents bugs!
type DocumentPoint = Point & { readonly [DocumentBrand]: true };
type ViewportPoint = Point & { readonly [ViewportBrand]: true };
type LayerPoint = Point & { readonly [LayerBrand]: true };
```

**Import branded types and factories:**

```typescript
import {
  DocumentPoint,
  DocumentRect,
  ViewportPoint,
  ViewportRect,
  LayerPoint,
  LayerRect,
  documentPoint,
  documentRect,
  viewportPoint,
  viewportRect,
  layerPoint,
  layerRect
} from '@mog/spreadsheet-contracts';
```

## Coordinate Spaces

| Space        | Types                           | Origin             | Units                  | Headers                                | Use Cases                                   |
| ------------ | ------------------------------- | ------------------ | ---------------------- | -------------------------------------- | ------------------------------------------- |
| **Cell**     | `CellCoord`                     | N/A                | Logical `{row, col}`   | N/A                                    | Cell references, selection                  |
| **Document** | `DocumentPoint`, `DocumentRect` | Cell A1            | Unzoomed pixels        | N/A                                    | Storage, formulas, object bounds            |
| **Viewport** | `ViewportPoint`, `ViewportRect` | Canvas top-left    | Screen pixels (zoomed) | **Includes** headers (50px, 24px)      | Mouse events, input handling                |
| **Layer**    | `LayerPoint`, `LayerRect`       | Cell area top-left | Screen pixels (zoomed) | **No headers** (ctx.translate handles) | Render layers, HitMap paths                 |
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
│ │ 2        │ │  HitMap paths registered in this space       │ ││
│ │ 3        │ │                                              │ ││
│ └──────────┴─┴──────────────────────────────────────────────┴─┘│
└─────────────────────────────────────────────────────────────────┘

Key insight:
- Viewport = Layer + header offsets (50px, 24px)
- viewportToLayer(vp) = layerPoint(vp.x - 50, vp.y - 24)
```

### Why Layer Space?

Render layers operate after `ctx.translate(headerWidth, headerHeight)` is applied. If we used viewport coordinates in the HitMap, there would be a 50px/24px offset between where shapes render and where hit testing thinks they are.

**The Bug (before branded types):**

```typescript
// Overlay layer renders at (100, 100) in layer space
ctx.fillRect(100, 100, 50, 50);
hitMap.registerPath(id, path); // Path is at (100, 100)

// Click handler receives viewport coords (150, 124)
// BUG: Passed directly to HitMap - misses by 50px, 24px!
hitMap.query(ctx, viewportX, viewportY);
```

**The Fix (with branded types):**

```typescript
// TypeScript ERROR: ViewportPoint not assignable to LayerPoint
hitMap.query(ctx, viewportPoint);

// CORRECT: Convert first
const layerPt = coords.viewportToLayer(viewportPoint);
hitMap.query(ctx, layerPt); // Now coordinates match!
```

## Core Interface

**Interface:** `@mog/spreadsheet-contracts/rendering` (canonical definition)
**Implementation:** `grid-renderer/src/coordinates/coordinate-system.ts` (`CoordinateSystemImpl`)

> **Note:** Core types and branded types are defined in `contracts/src/rendering/coordinates.ts` and re-exported from `@mog/spreadsheet-contracts`. The `grid-renderer/src/coordinates/types.ts` file re-exports these types.

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

> **Note:** Most conversion methods take a `sheetId` parameter. Methods that operate purely in viewport/layer space (like `viewportToLayer`) do not need it.

## Creating Branded Coordinates

At boundaries where you know the coordinate space, use factory functions:

```typescript
import { documentPoint, viewportPoint, layerPoint } from '@mog/spreadsheet-contracts';

// From mouse event (viewport space)
function handleClick(event: MouseEvent) {
  const vp = viewportPoint(event.offsetX, event.offsetY);
  const hit = coords.hitTestPoint(vp);
}

// From storage (document space)
const docBounds = documentRect(object.x, object.y, object.width, object.height);

// Converting for render layers
const layerBounds = coords.documentToLayerViewport(docBounds);
```

## Common Patterns

### Mouse Event → Hit Test → Storage

```typescript
function handleMouseDown(event: MouseEvent) {
  // 1. Mouse events are in viewport space
  const vp = viewportPoint(event.offsetX, event.offsetY);

  // 2. Hit test expects viewport coords (internally converts to layer for HitMap)
  const hit = coords.hitTestPoint(vp);

  // 3. Convert to document for storage operations
  const doc = coords.viewportToDocument(vp);
  const cell = coords.documentToCell(doc);
}
```

### Rendering Floating Objects

```typescript
function renderObject(object: FloatingObject, ctx: RenderContext) {
  // 1. Object bounds stored in document space
  const docBounds = documentRect(object.x, object.y, object.width, object.height);

  // 2. Convert to layer space (NOT viewport - ctx.translate handles headers)
  const layerBounds = ctx.coords.documentToLayerViewport(docBounds);
  if (!layerBounds) return; // Not visible

  // 3. Draw and register hit path in layer space
  const path = new Path2D();
  path.rect(layerBounds.x, layerBounds.y, layerBounds.width, layerBounds.height);
  ctx.fill(path);
  hitMap.registerPath(object.id, path, 'body'); // Path in layer coords
}
```

### HitMap Queries

```typescript
function queryFloatingObjects(vpPoint: ViewportPoint) {
  // HitMap paths are registered in layer space
  // Must convert viewport → layer before querying
  const layerPt = coords.viewportToLayer(vpPoint);
  return hitMap.query(ctx, layerPt);
}
```

## Position & Merge Indexes

The legacy `DimensionProvider` interface has been replaced by two specialized index classes that provide O(1) lookups from binary viewport buffer data. These are injected into `CoordinateSystemImpl` via setter methods.

### ViewportPositionIndex

**File:** `grid-renderer/src/coordinates/viewport-position-index.ts`

Provides O(1) position lookups for the canvas renderer's hot path. Backed by `Float64Array` data from the `BinaryViewportBuffer`. Falls back to default-based estimates for indices outside the prefetch range.

```typescript
class ViewportPositionIndex {
  setPositions(rowPositions: Float64Array | null, colPositions: Float64Array | null,
               startRow: number, startCol: number): void;

  getRowTop(row: number): number;   // O(1) pixel position of row's top edge
  getColLeft(col: number): number;  // O(1) pixel position of column's left edge
  getRowHeight(row: number): number;
  getColWidth(col: number): number;
  isRowHidden(row: number): boolean;
  isColHidden(col: number): boolean;
  findRowAtY(y: number): number | null;  // Binary search
  findColAtX(x: number): number | null;  // Binary search
}
```

### ViewportMergeIndex

**File:** `grid-renderer/src/coordinates/viewport-merge-index.ts`

Provides O(1) merge point-queries. Uses a flat `Map<number, MergeRegion>` keyed by `row * MAX_COLS + col`. Every cell coordinate within a merge points to the same `MergeRegion` object, trading memory for constant-time lookup with zero string allocation.

```typescript
class ViewportMergeIndex {
  setMerges(merges: BinaryMergeInput[]): void;
  getMergedRegion(row: number, col: number): MergeRegion | null;
}
```

The `CoordinateSystem` consumes these via minimal interfaces (`ViewportPositionIndexLike`, `ViewportMergeIndexLike`) defined in `@mog/spreadsheet-contracts/rendering`.

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

- Frozen cells: viewport coords = document coords (they don't scroll)
- Non-frozen cells: viewport coords = document coords - scroll offset + frozen offset

## Hit Testing

**File:** `grid-renderer/src/coordinates/coordinate-system.ts`

The `classifyPoint()` method determines what type of element is at given viewport coordinates:

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
  // - { type: 'frozen', region: 'topLeft' }
  // - { type: 'empty' }
}
```

**Touch-aware hit areas:** When `isTouch` is true, hit areas are expanded to meet accessibility guidelines (Apple HIG recommends 44x44 points minimum for touch targets).

## Helper Functions

**File:** `grid-renderer/src/coordinates/coordinate-system.ts`

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
function isOnFillHandle(point: Point, selectionRect: Rect, handleSize: number = 10): boolean;
```

### Table Resize Handle Hit Testing (Track 10: Tables)

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
documentToCell(point: Point): CellCoord | null {
  const row = this.binarySearchRow(point.y);
  const col = this.binarySearchCol(point.x);

  // Check for merged regions
  const merged = this.getMergedRegion({ row, col });
  return merged ? merged.start : { row, col };
}
```

### Zoom Handling

Zoom is applied to viewport coordinates:

```typescript
documentToViewport(rect: Rect): Rect | null {
  // ... calculate viewport position ...

  return {
    x: viewportX * this.zoom,
    y: viewportY * this.zoom,
    width: rect.width * this.zoom,
    height: rect.height * this.zoom,
  };
}
```

### Scroll-to-Cell

Calculates scroll offset to bring a cell into view:

```typescript
getScrollToCell(cell: CellCoord, padding: number = 20): ScrollOffset | null {
  if (this.isCellFrozen(cell)) return null;  // Frozen = always visible

  const cellRect = this.cellToDocument(cell);
  // Calculate if cell is outside visible bounds
  // Return new scroll position or null if already visible
}
```

### Viewport Bounds for Auto-Scroll

```typescript
getViewportBounds(): { left: number; top: number; right: number; bottom: number } {
  // Returns the scrollable region boundaries, excluding frozen panes and headers.
  // Used by auto-scroll service during drag operations.
}
```

## Usage Examples

### Rendering (virtualized cells)

```typescript
function renderVisibleCells(ctx: CanvasRenderingContext2D, coords: CoordinateSystem) {
  const regions = coords.getVisibleRegions();

  if (regions.frozenCorner) renderRegion(ctx, coords, regions.frozenCorner);
  if (regions.frozenRows) renderRegion(ctx, coords, regions.frozenRows);
  if (regions.frozenCols) renderRegion(ctx, coords, regions.frozenCols);
  renderRegion(ctx, coords, regions.main);
}
```

### Hit Testing (mouse clicks)

```typescript
function handleMouseDown(e: MouseEvent, coords: CoordinateSystem) {
  const cell = coords.viewportToCell({ x: e.offsetX, y: e.offsetY });
  if (cell) {
    selectionActor.send({ type: 'MOUSE_DOWN', cell, ... });
  }
}
```

### Keyboard Navigation

```typescript
function handleArrowKey(direction: Direction, selection: Selection, coords: CoordinateSystem) {
  const newActiveCell = moveCell(selection.activeCell, direction);
  const scrollTo = coords.getScrollToCell(newActiveCell);

  if (scrollTo) {
    rendererActor.send({ type: 'SCROLL_TO', ...scrollTo });
  }
}
```

## Viewports Subdirectory

**Location:** `grid-renderer/src/viewports/`

The viewports module provides higher-level viewport management on top of the coordinate system:

### Core Files

| File                       | Description                                                            |
| -------------------------- | ---------------------------------------------------------------------- |
| `viewport.ts`              | Viewport calculations for virtual scrolling, visible range detection   |
| `compute-layout.ts`        | Pure function to compute complete ViewportLayout from inputs           |
| `compute-visible-range.ts` | Compute which cells are visible, properly excluding hidden rows/cols   |
| `hit-testing.ts`           | Hit testing against ViewportLayout with divider and viewport detection |
| `scroll.ts`                | Scroll behavior computation, clamping, and scroll-to-cell              |
| `types.ts`                 | Type definitions for Viewport, ViewportLayout, ScrollBehavior, etc.    |

### Configuration Files

| File                | Description                                             |
| ------------------- | ------------------------------------------------------- |
| `configs/freeze.ts` | Freeze pane viewport layout computation (1-4 viewports) |
| `configs/index.ts`  | Configuration exports                                   |

### Viewport Layout Structure

The `computeViewportLayout()` function returns:

```typescript
interface ViewportLayout {
  viewports: Viewport[]; // All viewports in z-order
  primaryViewportId: string; // Main scrollable viewport ID
  dividers: ViewportDivider[]; // Freeze pane divider lines
  contentSize: Size; // Total content dimensions
  maxScroll: Point; // Maximum scroll position
  headerInfo: HeaderRenderInfo; // Freeze-aware header rendering info
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

- `freeze-corner` - Top-left intersection (no scroll)
- `freeze-rows` - Top row (horizontal scroll only)
- `freeze-cols` - Left column (vertical scroll only)
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
const result = hitTestLayout(layout, point, dimensionProvider);

// Result types:
// - { type: 'viewport', viewport, cell, localPoint }
// - { type: 'divider', divider, index }
// - { type: 'empty' }
```

## File Structure

```
grid-renderer/src/coordinates/
+-- types.ts                      # Re-exports from @mog/spreadsheet-contracts
+-- coordinate-system.ts          # CoordinateSystemImpl
+-- viewport-position-index.ts    # O(1) position lookups from binary buffer
+-- viewport-merge-index.ts       # O(1) merge lookups from binary buffer
+-- index.ts                      # Public exports

grid-renderer/src/viewports/
+-- types.ts                      # Viewport, ViewportLayout, ScrollBehavior
+-- viewport.ts                   # Viewport calculations, pixelToCell
+-- compute-layout.ts             # ViewportLayout computation
+-- compute-visible-range.ts      # Visible cell range calculation
+-- hit-testing.ts                # Layout hit testing
+-- scroll.ts                     # Scroll behavior and clamping
+-- index.ts                      # Public exports
+-- configs/
|   +-- freeze.ts                 # Freeze pane viewport configs
|   +-- index.ts                  # Config exports
```
