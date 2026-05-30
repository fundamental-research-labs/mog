# Canvas & Rendering Architecture

## Overview

The renderer uses a **small stacked-canvas host** with logical layers, a **priority-based scheduler** for frame orchestration, and **viewport virtualization** so rendering work stays bounded by the visible sheet area.

## Canvas Stack Architecture

`GridRenderer` creates a `CanvasEngine` with two stacked canvases by default:

| Canvas | Layer Class      | Contents                                                |
| ------ | ---------------- | ------------------------------------------------------- |
| 0      | World-space      | Grid layers, headers, dividers, and floating objects    |
| 1      | Screen-space     | Overlay chrome such as handles, guides, drag previews   |

Most spreadsheet drawing still happens as logical layers on canvas 0. The overlay package renders screen-space UX chrome on canvas 1. `createCanvasEngine()` can fall back to single-canvas mode on low-memory devices; in that mode, layers targeting higher canvas indexes are proxied onto canvas 0.

Performance concerns are solved by:

1. **Virtualization** - Only render visible cells
2. **Dirty region tracking** - Only redraw what changed
3. **Offscreen bitmap caching** - Cache expensive renders
4. **requestAnimationFrame batching** - Process invalidations and paint in frame batches

## Logical Layers

**Directory:** `canvas/grid-renderer/src/layers/`

Grid layers are drawn in z-order on canvas 0. The default grid-renderer layer set contains 11 layers with integer z-indexes:

| Z-Index | Layer ID            | Render Mode  | Purpose                                      |
| ------- | ------------------- | ------------ | -------------------------------------------- |
| 0       | background          | per-region   | Grid lines, alternating rows                 |
| 100     | cells               | per-region   | Cell content, formatting                     |
| 125     | validationCircles   | per-region   | Circle Invalid Data indicators               |
| 150     | pageBreaks          | per-region   | Page break preview lines                     |
| 250     | traceArrows         | per-region   | Formula auditing trace arrows                |
| 300     | remote-cursors      | per-region   | Collaborator selections                      |
| 400     | ui                  | per-region   | Fill handle, marching ants, resize handles   |
| 700     | sticky-headers      | per-region   | Sticky table headers                         |
| 800     | headers             | once         | Row/column headers (no scroll)               |
| 850     | selection           | per-region   | Selection boxes, range highlights over chrome |
| 900     | dividers            | once         | Freeze pane divider lines (no scroll)        |

### Layer Files

| File                    | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `base-layer.ts`         | Abstract base class with dirty tracking and caching   |
| `background.ts`         | Grid lines, alternating row colors                    |
| `cells.ts`              | Cell content and formatting                           |
| `validation-circles.ts` | Circle indicators for invalid data validation         |
| `page-breaks.ts`        | Page break preview lines (manual and automatic)       |
| `selection.ts`          | Selection boxes, range highlights                     |
| `trace-arrows.ts`       | Formula auditing trace arrows (precedents/dependents) |
| `remote-cursors.ts`     | Collaborator cursors/selections                       |
| `ui.ts`                 | Fill handle, marching ants, drag preview, resize      |
| `sticky-headers.ts`     | Sticky table headers                                  |
| `headers.ts`            | Row/column headers                                    |
| `dividers.ts`           | Freeze pane divider lines                             |

### CanvasLayer Interface

**File:** `canvas/engine/src/core/types.ts`

All layers implement the `CanvasLayer` interface from `@mog/canvas-engine`:

```typescript
interface CanvasLayer {
  readonly id: string;
  readonly zIndex: number;
  readonly renderMode: 'per-region' | 'once';
  readonly canvas: number;
  readonly clipPadding?: number;

  render(ctx: CanvasRenderingContext2D, region: RenderRegion, frame: FrameContext): void;
  isDirty(): boolean;
  markDirty(hint?: DirtyHint): void;
  markClean(): void;
  getDirtyRects?(): readonly DocSpaceRect[];
  isFullDirty?(): boolean;
  getContinuousFrameDirtyHint?(): DirtyHint;
  dispose(): void;
}
```

- `per-region` layers are rendered once per `RenderRegion` with clip, translate, and scale (content that scrolls with the document).
- `once` layers are rendered at canvas-absolute coordinates with no clip (chrome that doesn't scroll, like headers and dividers).

### BaseLayer Abstract Class

**File:** `canvas/grid-renderer/src/layers/base-layer.ts`

The `BaseLayer` abstract class provides dirty tracking and off-screen canvas caching so concrete layers only need to implement `render()`:

```typescript
abstract class BaseLayer implements CanvasLayer {
  readonly id: string;
  readonly zIndex: number;
  readonly renderMode: 'per-region' | 'once';
  readonly canvas: number;
  readonly cacheable: boolean;
  readonly clipPadding: number;

  // Dirty tracking via DirtyRectAccumulator
  isDirty(): boolean;
  markDirty(hint?: DirtyHint): void;
  markClean(): void;
  getDirtyRects(): readonly DocSpaceRect[];
  isFullDirty(): boolean;

  // Off-screen canvas caching for per-layer compositing
  getOrCreateCache(physicalWidth: number, physicalHeight: number): { canvas, ctx } | null;
  clearCache(): void;
  getCacheCanvas(): OffscreenCanvas | HTMLCanvasElement | null;
  invalidateCache(): void;

  // Subclasses implement the actual rendering
  abstract render(ctx: CanvasRenderingContext2D, region: RenderRegion, frame: FrameContext): void;
}
```

### Layer Visibility

Visibility is managed per-layer via `LayerRegistry.setVisibility()` in `canvas/engine/src/registry/layer-registry.ts`. There is no global `LayerVisibility` interface; instead, the `LayerRegistry` tracks a `visible` boolean per registered layer:

```typescript
class LayerRegistry {
  setVisibility(id: string, visible: boolean): void;
  isVisible(id: string): boolean;

  // Only visible layers are returned by sorted access methods
  getLayersForCanvas(canvasIndex: number): ReadonlyArray<CanvasLayer>;
  getAllSorted(): ReadonlyArray<CanvasLayer>;
}
```

All layers default to visible on registration. Feature-specific layers such as `validationCircles` and `pageBreaks` remain registered and typically render no-op until their data source state enables the corresponding mode.

### Dirty Region Optimization

Not every layer redraws on every frame. Each `BaseLayer` uses a `DirtyRectAccumulator` to track either a full-dirty flag or specific dirty rectangles:

```typescript
// Mark specific document-space pixel regions dirty
layer.markDirty({ type: 'rect', bounds: docSpaceRect(x, y, width, height) });
layer.markDirty({ type: 'rects', bounds: [rect1, rect2] });

// Or mark entire layer dirty
layer.markDirty({ type: 'full' });

// Query dirty state
layer.isDirty();      // Any dirty state at all?
layer.isFullDirty();  // Entire layer needs redraw?
layer.getDirtyRects(); // Specific document-space dirty rects
```

The `LayerRegistry.hasDirtyLayers()` method checks whether any visible layer on a canvas needs redraw. Full-dirty frames repaint the canvas; partial-dirty frames re-render dirty cached layers and composite the dirty region from layer caches, while non-cacheable dirty layers render directly.

## Render Scheduling

Scheduling is split between two layers:

1. **Canvas Engine** (`canvas-engine`) — owns the render loop and `PriorityScheduler` for frame-level orchestration.
2. **GridRenderScheduler** (`canvas/grid-canvas/src/renderer/grid-render-scheduler.ts`) — bridges data mutations to canvas layer invalidation.

### GridRenderScheduler

Implements the "Write = Invalidate" contract. When the `BinaryViewportBuffer` receives patches, the scheduler marks appropriate layers dirty and wakes the render loop via `CanvasEngine.requestFrame()`.

```typescript
class GridRenderScheduler implements RenderScheduler {
  markCellsDirty(cells?: { row: number; col: number }[]): void;
  markGeometryDirty(): void;
  markAllDirty(): void;
}
```

**Two-phase dirty expansion for cell mutations:**

1. **Phase 1: Dependency expansion** — delegates to `DirtyCellExpander` to find render-derived dependencies (e.g., text overflow neighbors).
2. **Phase 2: Coordinate resolution** — resolves cells to pixel rects via `ViewportPositionIndex` and `ViewportMergeIndex`, then passes `DirtyHint` rects to the engine.

**Layer invalidation groups:**

| Mutation Type | Layers Invalidated                                                  |
| ------------- | ------------------------------------------------------------------- |
| Cell content  | `cells`                                                             |
| Geometry      | `cells`, `headers`, `selection`, `background`, `sticky-headers`, `dividers` |

## Grid Renderer

**File:** `canvas/grid-canvas/src/renderer/grid-renderer.ts`

Thin composition facade that wires together 4 canvas packages:

1. `@mog/canvas-engine` — generic multi-canvas render loop, scheduler, input
2. `@mog/grid-renderer` — cell/background/selection/header layers
3. `@mog/drawing-canvas` — floating object scene graph + renderers
4. `@mog/canvas-overlay` — screen-space UX chrome (handles, guides, ink)

Implements the `GridRenderer` contract from `@mog-sdk/contracts/rendering`.

## Render Context

**File:** `canvas/grid-canvas/src/renderer/render-context.ts`

The monolithic `RenderContext` interface has been retired. In its place, the grid renderer uses **typed data source adapters** defined in `@mog-sdk/contracts/rendering`. Each layer receives only the data sources it needs (e.g., `CellDataSource`, `SelectionDataSource`, `FloatingObjectDataSource`).

The legacy `RenderContextConfig` (80+ fields) is still accepted by the `GridRenderer.updateContext()` facade, which dispatches each field to the appropriate typed adapter at O(1) per-field cost.

## Visibility-Based Lifecycle

**Suspended tabs use zero CPU.**

| State       | Description                      |
| ----------- | -------------------------------- |
| `ready`     | Tab visible, render loop running |
| `suspended` | Tab hidden, render loop paused   |

On `visibilitychange`:

- `hidden` -> suspend the renderer, pausing the render loop and scheduler
- `visible` -> resume the renderer and request a fresh repaint

## File Structure

The renderer spans multiple packages:

```
grid-renderer/src/                  # Layer implementations and coordinate system
|-- coordinates/                    # Coordinate system
|   |-- types.ts                    # Re-exports from @mog-sdk/contracts
|   |-- coordinate-system.ts        # CoordinateSystemImpl
|   |-- viewport-position-index.ts  # O(1) position lookups from binary buffer
|   |-- viewport-merge-index.ts     # O(1) merge lookups from binary buffer
|   +-- index.ts
|
|-- layers/                         # Render layers
|   |-- base-layer.ts               # Abstract BaseLayer with dirty tracking + caching
|   |-- background.ts               # Grid lines, alternating rows (z: 0)
|   |-- cells.ts                    # Cell content and formatting (z: 100)
|   |-- cells/                      # Cell rendering sub-components
|   |-- validation-circles.ts       # Validation circle indicators (z: 125)
|   |-- page-breaks.ts              # Page break preview lines (z: 150)
|   |-- selection.ts                # Selection boxes, range highlights (z: 850)
|   |-- trace-arrows.ts             # Formula auditing arrows (z: 250)
|   |-- remote-cursors.ts           # Collaborator cursors (z: 300)
|   |-- ui.ts                       # Fill handle, marching ants, resize (z: 400)
|   |-- sticky-headers.ts           # Sticky table headers (z: 700)
|   |-- headers.ts                  # Row/column headers (z: 800)
|   |-- dividers.ts                 # Freeze pane dividers (z: 900)
|   +-- index.ts
|
|-- viewports/                      # Viewport management
|   |-- types.ts
|   |-- viewport.ts
|   |-- hit-testing.ts
|   |-- scroll.ts
|   +-- index.ts
|
+-- index.ts

canvas/engine/src/                  # Generic render loop and layer management
|-- host/
|   +-- canvas-host.ts              # Stacked canvas creation and DPR/resize handling
|-- loop/
|   +-- render-loop.ts              # rAF loop, dirty-region rendering, compositing
|-- registry/
|   +-- layer-registry.ts           # LayerRegistry (visibility, dirty tracking)
|-- scheduler/
|   +-- priority-scheduler.ts       # Priority task queue processed by the render loop
+-- ...

canvas/grid-canvas/src/renderer/    # Composition facade
|-- grid-renderer.ts                # GridRenderer facade (wires all packages)
|-- grid-render-scheduler.ts        # GridRenderScheduler (data → layer invalidation)
|-- render-context.ts               # Re-exports (legacy RenderContext retired)
+-- index.ts

canvas/grid-canvas/src/viewports/    # Viewport layout for the facade
|-- compute-layout.ts
|-- scroll.ts
|-- types.ts
+-- index.ts
```
