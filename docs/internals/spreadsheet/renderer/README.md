# Renderer Architecture

## Overview

The spreadsheet renderer path combines **XState actors** for interaction state, a **SheetCoordinator/system boundary** for cross-system wiring, `@mog-sdk/sheet-view` for the rendering substrate, and Rust compute viewport buffers for live document data.

**Status and public surface:** this is an internal architecture page for the workspace spreadsheet app. The shipped public low-level view package is `@mog-sdk/sheet-view`. The app package (`@mog/app-spreadsheet`), `@mog/shell`, `@mog-sdk/kernel`, and the `@mog/*` canvas packages referenced below are workspace-internal implementation packages; public integrations should use the public package guides for `@mog-sdk/sheet-view`, `@mog-sdk/embed`, `@mog-sdk/spreadsheet-app`, or `@mog-sdk/node`.

**Related docs:**

- [Binary Wire Pipeline](binary-wire-pipeline.md) - Critical fast path: Rust binary serialization → IPC → ViewportCoordinator (epoch-based overlay filtering) → zero-copy TS decoding → canvas rendering
- [Coordinate System](coordinates.md) - Viewport math, frozen panes, hit testing
- [Canvas & Layers](canvas.md) - Canvas engine, grid/drawing/overlay layers, scheduler-driven rendering
- [XState Patterns](xstate.md) - Machine definitions, coordinator, Rust/Yrs integration

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              React Components                            │
│  SpreadsheetGrid.tsx, OverlayLayers.tsx, editor/DOM overlays             │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ uses
┌───────────────────────────────────▼─────────────────────────────────────┐
│                              React Hooks                                 │
│  useSelection, useEditorState/actions, useClipboard                     │
│  useRendererStatus/actions, useInputState/handlers                      │
│  useGridMouse, useGridKeyboard, useRemoteCursors                        │
│  useFocus, useFindReplace, object/chart hooks                           │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ wraps
┌───────────────────────────────────▼─────────────────────────────────────┐
│                            SheetCoordinator                              │
│  - Creates the 5 systems and shared infrastructure                      │
│  - Wires cross-machine communication                                    │
│  - Delegates renderer lifecycle to RenderSystem                         │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ manages
┌───────────────────────────────────▼─────────────────────────────────────┐
│                               Systems                                    │
│  GridEditing, Render, Objects, Input, Ink                               │
│  - Own actors, coordination modules, execution services                  │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ own
┌───────────────────────────────────▼─────────────────────────────────────┐
│                            XState Actors                                 │
│  grid-selection, grid-editor, clipboard, grid-renderer, grid-input,    │
│  focus (@mog/shell), chart, find-replace, diagram, ink, ...            │
│  State machines plus injected services; DOM/canvas effects stay in      │
│  systems/execution layers                                               │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ renderer execution creates
┌───────────────────────────────────▼─────────────────────────────────────┐
│                         @mog-sdk/sheet-view                              │
│  Public handle; wraps workspace-internal canvas/grid/drawing layers      │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ binds through WorkbookViewport
┌───────────────────────────────────▼─────────────────────────────────────┐
│                   ViewportCoordinator (per viewport)                      │
│  Single owner for viewport binary buffer + epoch-based overlay model.   │
│  Both mutation patches and viewport fetches write through here.          │
│  Epoch filtering replaces stale-detection/retry logic.                   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ backed by
┌───────────────────────────────────▼─────────────────────────────────────┐
│                       Rust compute document                              │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Design Principles

### 1. Actors Own State, Systems Own Execution

The renderer lifecycle machine owns state transitions. `RenderSystem` and `renderer-execution.ts` subscribe to those transitions and execute runtime work such as creating `SheetView`, attaching the workbook, starting the render loop, switching sheets, and disposing resources. Other machines follow the same boundary where possible; async work such as editor commits is injected by the owning system rather than importing renderer or DOM dependencies directly into machine code.

```typescript
// Machine: lifecycle state transition
initializing: {
  on: {
    INITIALIZED: {
      target: 'ready',
      actions: ['setCurrentSheet', 'resetRetryCount', 'clearPendingActions'],
    },
  }
}

// Execution layer: runtime side effects based on state
rendererActor.subscribe((state) => {
  if (state.value === 'initializing' && !sheetView) {
    sheetView = createSheetView({
      container,
      showHeaders,
      showGridlines,
      scrollable: false, // the app's InputSystem owns scroll policy
    });
    sheetView.viewport.setFrozenPanes(frozenPanes);
    sheetView.attach({ initialSheetId, workbook });
    sheetView.renderState.update({ viewOptions });
    rendererActor.send({ type: 'INITIALIZED', sheetId: initialSheetId });
  }
  if (state.value === 'ready') {
    sheetView?.start();
  }
});
```

The real execution path also applies split/freeze layout, persisted scroll, culture, and bridge callbacks before signaling `INITIALIZED`.

### 2. Machines Never Import Each Other

Machine definitions do not import other machine definitions for direct sends. Cross-machine communication goes through system coordination modules, actor-access command/accessor layers, and the `SheetCoordinator`.

### 3. Remote Updates Are First-Class Events

Machines that receive collaboration or replay inputs model them as explicit events, such as `REMOTE_CELL_CHANGED`, `REMOTE_SELECTION_CHANGED`, `REMOTE_CHART_DELETED`, or source-tagged `SET_SELECTION` events. Remote cursor rendering flows through the collaboration hooks and renderer context rather than yanking the local viewport.

## State Machines

The main spreadsheet interaction machines are grouped under the five coordinator-owned systems that `SheetCoordinator` creates in `apps/spreadsheet/src/systems/`:

- **grid-editing/machines/** — selection, editor, clipboard, find-replace, comment, draw-border, slicer
- **input/machines/** — input, pane-focus
- **renderer/machines/** — renderer, page-break
- **objects/machines/** — chart, object-interaction, diagram
- **ink/machines/** — ink drawing

The **focus machine** comes from the workspace-internal `@mog/shell` package (imported from `shell/src/machines/focus-machine.ts`), not from the spreadsheet app.

### Selection Machine

**File:** `apps/spreadsheet/src/systems/grid-editing/machines/grid-selection-machine.ts`

| State                      | Description                                     |
| -------------------------- | ----------------------------------------------- |
| `idle`                     | Static selection, waiting for input             |
| `selecting`                | Mouse down, dragging to select range            |
| `extending`                | Shift+click extending selection                 |
| `multiSelecting`           | Ctrl+click adding ranges                        |
| `selectingRangeForFormula` | Picking range while editing formula (nested)    |
| `draggingFillHandle`       | Left-click autofill operation                   |
| `rightDraggingFillHandle`  | Right-click autofill (shows context menu)       |
| `draggingCells`            | Moving/copying cells via drag-drop              |
| `selectingColumn`          | Column header selection                         |
| `selectingRow`             | Row header selection                            |
| `resizingHeader`           | Dragging column/row resize handle               |
| `resizingTable`            | Dragging table resize handle                     |

### Editor Machine

**File:** `apps/spreadsheet/src/systems/grid-editing/machines/grid-editor-machine.ts`

The editor machine uses **nested states** for Enter Mode vs Edit Mode (Excel parity):

| State                       | Description                                 |
| --------------------------- | ------------------------------------------- |
| `inactive`                  | No editing                                  |
| `activating`                | Preparing to edit                           |
| `editing.enterMode`         | Normal editing - arrows commit and move     |
| `editing.editMode`          | Normal editing - arrows move cursor in text |
| `formulaEditing.enterMode`  | Formula editing - arrows insert references  |
| `formulaEditing.editMode`   | Formula editing - arrows move cursor        |
| `richTextEditing.enterMode` | Rich text editing - arrows commit and move  |
| `richTextEditing.editMode`  | Rich text editing - arrows move cursor      |
| `imeComposing`              | IME composition (CJK input)                 |
| `validating`                | Checking value before commit                |
| `committing`                | Writing value                               |
| `error`                     | Validation failed                           |

**Enter Mode vs Edit Mode:**

- **Enter Mode**: Activated by typing directly into a cell. Arrow keys commit and move selection.
- **Edit Mode**: Activated by F2, double-click, or formula bar click. Arrow keys move cursor within text.

### Clipboard Machine

**File:** `apps/spreadsheet/src/systems/grid-editing/machines/clipboard-machine.ts`

| State          | Description              |
| -------------- | ------------------------ |
| `empty`        | No clipboard data        |
| `hasCopy`      | Copied data available    |
| `hasCut`       | Cut data (marching ants) |
| `pastePreview` | Showing paste preview    |
| `pasteError`   | Paste failed, retryable   |
| `pasting`      | Paste in progress        |

### Renderer Machine

**File:** `apps/spreadsheet/src/systems/renderer/machines/grid-renderer-machine.ts`

| State              | Description                            |
| ------------------ | -------------------------------------- |
| `unmounted`        | No resources allocated                 |
| `waitingForLayout` | Container mounted, awaiting dimensions |
| `initializing`     | Creating renderer                      |
| `ready`            | Fully operational                      |
| `switchingSheet`   | Transitioning sheets                   |
| `suspended`        | Tab hidden, render loop paused         |
| `error`            | Operation failed                       |
| `disposing`        | Cleaning up                            |

### Additional State Machines

| Machine                        | File                                                      | Purpose                                     |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------- |
| **Input Machine**              | `systems/input/machines/grid-input-machine.ts`            | Mouse, touch, wheel, pan, zoom input        |
| **Focus Machine**              | `shell/src/machines/focus-machine.ts` (`@mog/shell`)      | Keyboard focus management                   |
| **Pane Focus Machine**         | `systems/input/machines/pane-focus-machine.ts`            | Focus between split panes                   |
| **Chart Machine**              | `systems/objects/machines/chart-machine.ts`               | Chart selection and editing                 |
| **Find Replace Machine**       | `systems/grid-editing/machines/find-replace-machine.ts`   | Find/replace dialog state                   |
| **Object Interaction Machine** | `systems/objects/machines/object-interaction-machine.ts`  | Floating object (image, shape) interactions |
| **Diagram Machine**            | `systems/objects/machines/diagram-machine.ts`             | Diagram object interactions                 |
| **Slicer Machine**             | `systems/grid-editing/machines/slicer-machine.ts`         | Slicer filtering interactions               |
| **Comment Machine**            | `systems/grid-editing/machines/comment-machine.ts`        | Cell comment editing                        |
| **Draw Border Machine**        | `systems/grid-editing/machines/draw-border-machine.ts`    | Draw border tool state                      |
| **Page Break Machine**         | `systems/renderer/machines/page-break-machine.ts`         | Page break preview mode                     |
| **Ink Machine**                | `systems/ink/machines/machine.ts`                         | Ink drawing state                           |

## Coordinator

**File:** `apps/spreadsheet/src/coordinator/sheet-coordinator.ts`

The coordinator is the spreadsheet app composition root. It:

1. Creates shared infrastructure such as the focus actor and floating object cache
2. Creates the 5 systems (GridEditing, Renderer, Objects, Input, Ink) with narrow configs
3. Starts systems in dependency order
4. Wires cross-system events (selection exclusivity, editor-focus sync, render context/invalidation, sheet switch)
5. Delegates renderer execution to `RenderSystem` and `renderer-execution.ts`
6. Dispatches pointer-up/cancel through system `DragTerminator`s and clears input pointer state
7. Processes mutation receipts for immediate floating-object cache and renderer patch updates
8. Implements `dispose()`

### Coordinator Configuration

```typescript
interface SheetCoordinatorConfig {
  initialSheetId: string;
  workbook: WorkbookInternal;                 // Unified Workbook API (required)
  platform?: Platform;                        // Keyboard platform for shortcuts
  getActiveSheetId?: () => string;            // Live getter for active sheet

  // Explicit feature flags
  enableKeyboard?: boolean;                   // Opt-in for keyboard handling
  readOnly?: boolean;                         // Blocks mutating operations

  // Action callbacks
  onUIAction?: (action: string) => void;
  onMetric?: (metric: Metric) => void;
  onRenderInvalidation?: (invalidation: RenderInvalidation) => void;
  confirmDialog?: (message: string) => boolean;

  // Feature-specific dependency bundles
  clipboardDependencies?: ClipboardDependencies;
  editorDependencies?: EditorDependencies;
  sheetSwitchDependencies?: SheetSwitchDependencies;
  toolbarDependencies?: ToolbarDependencies;

  // Input configuration
  inputConfig?: Partial<InputCoordinatorConfig>;
}
```

`onRenderInvalidation` is declared on the config type; the current app path invalidates rendering through system callbacks and `setRendererDependencies()`.

### Coordinator Structure

`SheetCoordinator` creates the systems, then wires feature-level coordination across them. Renderer instance lifecycle is owned below the coordinator by `apps/spreadsheet/src/systems/renderer/render-system.ts` and `apps/spreadsheet/src/systems/renderer/execution/renderer-execution.ts`.

```
apps/spreadsheet/src/coordinator/
├── sheet-coordinator.ts        # Main composition root
├── shell-coordinator.ts        # Shell-level coordinator
├── factory.ts                  # Coordinator factory
├── types.ts                    # Config and dependency types
├── connector-rerouting.ts      # Connector re-routing wiring
├── editor-transition-handlers.ts
├── receipt-processing.ts
├── actor-access/               # Actor access layer
├── features/                   # Cross-system feature coordination
├── mutations/                  # Document mutations
├── sparklines/                 # Sparkline coordination
├── tables/                     # Table coordination helpers
└── view-clipboard-data.ts      # Clipboard data view
```

The 5 systems that contain the actual domain logic:

```
apps/spreadsheet/src/systems/
├── grid-editing/               # Selection, editing, clipboard, etc.
│   ├── grid-editing-system.ts
│   ├── machines/               # grid-selection, grid-editor, clipboard, etc.
│   ├── coordination/           # Cross-machine coordination
│   ├── features/               # Feature-specific logic
│   └── subscriptions/          # Event subscriptions
├── input/                      # Mouse, touch, wheel, keyboard input
│   ├── input-system.ts
│   └── machines/               # grid-input, pane-focus
├── renderer/                   # Canvas rendering and lifecycle
│   ├── render-system.ts
│   ├── execution/              # SheetView lifecycle delegation
│   ├── coordination/           # Renderer coordination modules
│   ├── subscriptions/          # Event subscriptions
│   └── machines/               # grid-renderer, page-break
├── objects/                    # Charts, images, shapes, diagrams
│   ├── object-system.ts
│   └── machines/               # chart, object-interaction, diagram
├── ink/                        # Ink drawing
│   ├── ink-system.ts
│   └── machines/               # ink machine
└── shared/                     # Shared types and utilities
```

### Key API

```typescript
class SheetCoordinator {
  // The 5 systems (public readonly)
  readonly grid: IGridEditingSystem;
  readonly renderer: IRenderSystem;
  readonly objects: IObjectSystem;
  readonly input: IInputSystem;
  readonly ink: IInkSystem;

  // Late-arriving dependencies from React layer
  setRendererDependencies(deps: RendererDependencies): void;

  handlePointerUp(): void;
  handlePointerCancel(): void;
  processReceipts(receipts: MutationReceipt[]): void;
  isActive(): boolean;
  dispose(): void;
}
```

Actors are accessed through the systems, e.g. `coordinator.grid.access.actors.selection`.

## React Hooks

**Directory:** `apps/spreadsheet/src/hooks/` (organized by domain subdirectory)

Representative hooks exported by `apps/spreadsheet/src/hooks/index.ts` or used directly by the grid component:

| Hook                       | Directory       | Purpose                        |
| -------------------------- | --------------- | ------------------------------ |
| `useSelection`             | `selection/`    | Selection state and actions    |
| `useSelectionActions`      | `selection/`    | Stable selection commands      |
| `useActiveCell`            | `selection/`    | Active cell state              |
| `useSelectionRanges`       | `selection/`    | Fine-grained selection state   |
| `useEditorState`           | `editing/`      | Cell editing state             |
| `useEditorActions`         | `editing/`      | Stable editor actions          |
| `useClipboard`             | `editing/`      | Copy/cut/paste operations      |
| `useInputState`            | `editing/`      | Gesture boundary state         |
| `useInputEventHandlers`    | `editing/`      | Stable DOM input handlers      |
| `useRendererStatus`        | `view/`         | Renderer state                 |
| `useRendererActions`       | `view/`         | Stable renderer commands       |
| `useGridMouse`             | `shared/`       | Grid pointer interaction       |
| `useKeyboard`              | `navigation/`   | Keyboard event handling        |
| `useGridKeyboard`          | `navigation/`   | Grid-specific keyboard wiring  |
| `useFocus`                 | `navigation/`   | Focus management               |
| `useFindReplace`           | `navigation/`   | Find/replace dialog            |
| `useRemoteCursors`         | `collab/`       | Presence cursor projection     |
| `useChartUI`               | `charts/`       | Chart UI machine state         |
| `useCharts`                | `charts/`       | Chart data operations          |
| `useObjectInteraction`     | `objects/`      | Floating object interactions   |
| `useDiagramUI`             | `objects/`      | Diagram object interactions    |
| `useCellProperties`        | `settings/`     | Cell formatting properties     |
| `useActionDependencies`    | `toolbar/`      | Action system dependencies     |

## React Component Integration

**File:** `apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx`

`SpreadsheetGrid` is the React composition layer for the grid. It uses granular state hooks and extracted effect hooks so render lifecycle, dependency injection, render-context updates, native clipboard events, and input routing flow through the coordinator and systems:

```typescript
function SpreadsheetGrid() {
  const coordinator = useCoordinator();
  const rendererStatus = useRendererStatus();
  const rendererActions = useRendererActions();
  const { isPanning } = useInputState();
  const inputHandlers = useInputEventHandlers();

  useRendererDependencies({ coordinator, viewport, getCellValue, getCellFormat, ... });
  useRenderContextConfig({ coordinator, remoteCursors, getTableAtCell, ... });
  useRendererLifecycle({ ...rendererStatus, activeSheetId, containerRef, ...rendererActions });
  useRendererSync({ ...rendererStatus, activeSheetId, ...rendererActions });
  useInputListeners({ containerRef, input: inputHandlers, onLongPress });
  useClipboardEvents({ enabled: true, containerRef });

  const keyboard = useGridKeyboard({ activeSheetId });
  const mouse = useGridMouse({ activeSheetId, containerRef, coordinator, ... });

  return (
    <div ref={containerRef} onDoubleClick={mouse.handleDoubleClick} onKeyDown={keyboard.handleKeyDown}>
      <ScrollContainer workbookSettings={workbookSettings} scrollWidth={scrollWidth} scrollHeight={scrollHeight} />
      <CanvasInteractiveOverlay interactiveElements={rendererActions.getInteractiveElements()} headerOffset={headerOffset} />
      <OutlineToggleOverlay />
      <OverlayLayers />
      <InlineCellEditor workbookSettings={workbookSettings} />
      <ValidationDropdownOverlay />
      <StatusOverlays />
    </div>
  );
}
```

## Canvas Layers

**Workspace-internal packages:** grid layers live in `@mog/grid-renderer` at `canvas/grid-renderer/src/layers/`. `@mog/grid-canvas` composes those layers with `@mog/drawing-canvas` and `@mog/canvas-overlay`. Public consumers should use `@mog-sdk/sheet-view` rather than importing these packages directly.

The default grid layers are created by `createGridLayers()` and registered into the canvas engine by `canvas/grid-canvas/src/renderer/grid-renderer.ts`. `grid-canvas` also registers the drawing layer and the screen-space overlay layer.

| Canvas | Z-Index | Layer ID            | Package               | Purpose                                      |
| ------ | ------- | ------------------- | --------------------- | -------------------------------------------- |
| 0      | 0       | background          | `@mog/grid-renderer`  | Grid lines, alternating rows                 |
| 0      | 100     | cells               | `@mog/grid-renderer`  | Cell content, formatting                     |
| 0      | 125     | validationCircles   | `@mog/grid-renderer`  | Circle Invalid Data indicators               |
| 0      | 150     | pageBreaks          | `@mog/grid-renderer`  | Page break preview lines                     |
| 0      | 250     | traceArrows         | `@mog/grid-renderer`  | Formula auditing trace arrows                |
| 0      | 300     | remote-cursors      | `@mog/grid-renderer`  | Collaborator selections                      |
| 0      | 400     | ui                  | `@mog/grid-renderer`  | Fill handle, marching ants, resize handles   |
| 0      | 500     | drawing             | `@mog/drawing-canvas` | Charts, pictures, shapes, equations, ink     |
| 0      | 700     | sticky-headers      | `@mog/grid-renderer`  | Sticky table headers                         |
| 0      | 800     | headers             | `@mog/grid-renderer`  | Row/column headers and outline controls      |
| 0      | 850     | selection           | `@mog/grid-renderer`  | Selection boxes and range highlights         |
| 0      | 900     | dividers            | `@mog/grid-renderer`  | Freeze/split dividers                        |
| 1      | 0       | overlay             | `@mog/canvas-overlay` | Object handles, guides, previews, ink chrome |

See [Canvas & Layers](canvas.md) for details.

## File Structure

```
apps/spreadsheet/src/
├── coordinator/                       # Composition root
│   ├── sheet-coordinator.ts           # Creates 5 systems, wires cross-system events
│   ├── shell-coordinator.ts           # Shell-level coordinator
│   ├── factory.ts                     # Coordinator factory
│   ├── types.ts                       # Config and dependency types
│   ├── actor-access/                  # Actor access layer
│   ├── features/                      # Cross-system feature coordination
│   ├── mutations/                     # Document mutations
│   ├── sparklines/                    # Sparkline coordination
│   └── tables/                        # Table coordination helpers
│
├── systems/                           # Domain logic lives here
│   ├── grid-editing/                  # Selection, editing, clipboard
│   │   ├── machines/
│   │   │   ├── grid-selection-machine.ts
│   │   │   ├── selection/             # Selection machine modules
│   │   │   ├── grid-editor-machine.ts
│   │   │   ├── editor/               # Editor machine modules
│   │   │   ├── clipboard-machine.ts
│   │   │   ├── find-replace-machine.ts
│   │   │   ├── comment-machine.ts
│   │   │   ├── draw-border-machine.ts
│   │   │   └── slicer-machine.ts
│   │   ├── coordination/             # Cross-machine coordination
│   │   └── features/                 # Feature-specific logic
│   │
│   ├── input/                         # Mouse, touch, wheel, keyboard
│   │   └── machines/
│   │       ├── grid-input-machine.ts
│   │       └── pane-focus-machine.ts
│   │
│   ├── renderer/                      # Canvas rendering and lifecycle
│   │   ├── render-system.ts
│   │   ├── execution/                 # SheetView lifecycle delegation
│   │   ├── coordination/
│   │   ├── subscriptions/
│   │   └── machines/
│   │       ├── grid-renderer-machine.ts
│   │       └── page-break-machine.ts
│   │
│   ├── objects/                       # Charts, images, shapes
│   │   └── machines/
│   │       ├── chart-machine.ts
│   │       ├── object-interaction-machine.ts
│   │       └── diagram-machine.ts
│   │
│   ├── ink/                           # Ink drawing
│   │   └── machines/
│   │       └── machine.ts
│   │
│   └── shared/                        # Shared types and utilities
│
├── hooks/                             # React hooks (organized by domain)
│   ├── selection/                     # use-selection, use-active-cell, etc.
│   ├── editing/                       # use-editor, use-clipboard, etc.
│   ├── navigation/                    # use-keyboard, use-focus, use-find-replace
│   ├── view/                          # use-renderer, use-page-breaks, etc.
│   ├── objects/                       # use-object-interaction, use-diagram, etc.
│   ├── charts/                        # use-chart, use-charts
│   └── ...
│
canvas/grid-renderer/                  # workspace-internal @mog/grid-renderer package
└── src/
    ├── layers/                        # Logical render layers
    │   ├── background.ts
    │   ├── cells.ts
    │   ├── validation-circles.ts
    │   ├── page-breaks.ts
    │   ├── selection.ts
    │   ├── trace-arrows.ts
    │   ├── remote-cursors.ts
    │   ├── ui.ts
    │   ├── headers.ts
    │   ├── dividers.ts
    │   └── sticky-headers.ts
    ├── cells/                         # Cell rendering
    ├── coordinates/                   # Coordinate system and viewport indices
    ├── features/                      # Renderer feature helpers
    ├── hit-test/                      # Grid hit testing
    ├── layout/                        # Visible-range and layout helpers
    ├── services/                      # Text measurement
    ├── viewports/                     # Viewport management
    └── shared/                        # Shared constants and helpers

canvas/grid-canvas/src/renderer/       # Composition facade
├── grid-renderer.ts                   # Creates CanvasEngine, registers grid/drawing/overlay layers
├── grid-render-scheduler.ts           # Buffer writes -> dirty layers -> frame requests
└── render-context.ts                  # Renderer data-source adapters

views/sheet-view/src/                   # @mog-sdk/sheet-view public handle implementation
├── sheet-view.ts                       # SheetView lifecycle, capabilities, workbook attach
├── viewport-wiring.ts                  # WorkbookViewport events -> VPI/VMI + dirty scheduling
└── capabilities/                       # Public capability handle implementations

canvas/drawing-canvas/src/layer/
└── drawing-layer.ts                   # Floating object drawing layer

canvas/overlay/src/
└── overlay-layer.ts                   # Screen-space object handles and previews

shell/src/machines/
└── focus-machine.ts                   # Focus machine (@mog/shell)
```

## Performance-Sensitive Paths

- `canvas/engine/src/loop/render-loop.ts` drives painting through `requestAnimationFrame`.
- `canvas/engine/src/scheduler/priority-scheduler.ts` owns prioritized frame tasks.
- `views/sheet-view/src/viewport-wiring.ts` subscribes to `WorkbookViewport` events, rebuilds VPI/VMI, and forwards dirty marks.
- `canvas/grid-canvas/src/renderer/grid-render-scheduler.ts` maps buffer writes and geometry changes to layer invalidation.
- `kernel/src/bridges/wire/viewport-coordinator.ts` owns the per-viewport binary buffer and epoch-filtered overlays.
- `apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx` prefers granular hooks such as `useRendererStatus`, `useRendererActions`, `useInputState`, and `useInputEventHandlers` to avoid broad React subscriptions.
