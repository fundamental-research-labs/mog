# Renderer Architecture

## Overview

The renderer uses **explicit XState state machines** for all user interactions, with a **coordinator pattern** for cross-machine communication and **Rust/Yrs CRDT integration** for real-time collaboration.

**Related docs:**

- [Binary Wire Pipeline](binary-wire-pipeline.md) - Critical fast path: Rust binary serialization → IPC → ViewportCoordinator (epoch-based overlay filtering) → zero-copy TS decoding → canvas rendering
- [Coordinate System](coordinates.md) - Viewport math, frozen panes, hit testing
- [Canvas & Layers](canvas.md) - Single canvas, priority scheduler, 60fps rendering
- [XState Patterns](xstate.md) - Machine definitions, coordinator, Rust/Yrs integration

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              React Components                            │
│  SpreadsheetGrid.tsx, CollaborationOverlay.tsx                          │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ uses
┌───────────────────────────────────▼─────────────────────────────────────┐
│                              React Hooks                                 │
│  use-selection, use-editor, use-clipboard, use-renderer                 │
│  use-keyboard, use-focus, use-input, use-collaboration                  │
│  use-find-replace, use-chart, use-object-interaction, ...               │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ wraps
┌───────────────────────────────────▼─────────────────────────────────────┐
│                            SheetCoordinator                              │
│  - Creates and owns all XState actors                                   │
│  - Owns canvas/renderer instances (executes side effects)               │
│  - Wires cross-machine communication                                    │
│  - Integrates with Rust/Yrs via ComputeBridge                           │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ manages
┌───────────────────────────────────▼─────────────────────────────────────┐
│                            XState Machines                               │
│  grid-selection, grid-editor, clipboard, grid-renderer, grid-input,    │
│  focus (@mog/shell), chart, find-replace, diagram, ink, ...            │
│  Pure state - no side effects                                           │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ reads/writes
┌───────────────────────────────────▼─────────────────────────────────────┐
│                   ViewportCoordinator (per viewport)                      │
│  Single owner for viewport binary buffer + epoch-based overlay model.   │
│  Both mutation patches and viewport fetches write through here.          │
│  Epoch filtering replaces stale-detection/retry logic.                   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ backed by
┌───────────────────────────────────▼─────────────────────────────────────┐
│                       Rust/Yrs Document (compute-core)                   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Design Principles

### 1. Machine Owns State, Coordinator Owns Execution

The state machines are **pure** - they only define states, events, and transitions. The coordinator subscribes to machine state and **executes side effects** (creating canvas, managing renderer instances).

```typescript
// Machine: pure state transitions
initializing: {
  on: {
    INITIALIZED: 'ready';
  } // No entry action that creates things
}

// Coordinator: executes based on state
rendererActor.subscribe((state) => {
  if (state.value === 'initializing' && !this.renderer) {
    this.renderer = this.createRenderer();
    rendererActor.send({ type: 'INITIALIZED' });
  }
});
```

### 2. Machines Never Import Each Other

All cross-machine communication goes through the coordinator. This keeps machines testable in isolation.

### 3. Remote Updates Are First-Class Events

Every machine handles `REMOTE_*` events explicitly. Collaboration is not bolted on - it's integral.

## State Machines

State machines are distributed across the 5 systems in `apps/spreadsheet/src/systems/`:

- **grid-editing/machines/** — selection, editor, clipboard, find-replace, comment, draw-border, slicer
- **input/machines/** — input, pane-focus
- **renderer/machines/** — renderer, page-break
- **objects/machines/** — chart, object-interaction, diagram
- **ink/machines/** — ink drawing

The **focus machine** comes from `@mog/shell` (imported from `shell/src/machines/focus-machine.ts`), not from the spreadsheet app.

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
| `resizingTable`            | Dragging table resize handle (Track 10: Tables) |

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
| **Input Machine**              | `systems/input/machines/grid-input-machine.ts`            | Mouse, touch, wheel input handling          |
| **Focus Machine**              | `shell/src/machines/focus-machine.ts` (`@mog/shell`)      | Keyboard focus management                   |
| **Pane Focus Machine**         | `systems/input/machines/pane-focus-machine.ts`            | Focus between split panes                   |
| **Chart Machine**              | `systems/objects/machines/chart-machine.ts`               | Chart selection and editing                 |
| **Find Replace Machine**       | `systems/grid-editing/machines/find-replace-machine.ts`   | Find/replace dialog state                   |
| **Object Interaction Machine** | `systems/objects/machines/object-interaction-machine.ts`  | Floating object (image, shape) interactions |
| **Diagram Machine**           | `systems/objects/machines/diagram-machine.ts`            | Diagram object interactions                |
| **Slicer Machine**             | `systems/grid-editing/machines/slicer-machine.ts`         | Slicer filtering interactions               |
| **Comment Machine**            | `systems/grid-editing/machines/comment-machine.ts`        | Cell comment editing                        |
| **Draw Border Machine**        | `systems/grid-editing/machines/draw-border-machine.ts`    | Draw border tool state                      |
| **Page Break Machine**         | `systems/renderer/machines/page-break-machine.ts`         | Page break preview mode                     |
| **Ink Machine**                | `systems/ink/machines/machine.ts`                         | Ink drawing state                           |

## Coordinator

**File:** `apps/spreadsheet/src/coordinator/sheet-coordinator.ts`

The coordinator is a ~250-line composition root that:

1. Creates the 5 systems (GridEditing, Renderer, Objects, Input, Ink) with narrow configs
2. Starts systems in dependency order
3. Wires cross-system events (selection exclusivity, editor-focus sync, render invalidation, sheet switch)
4. Implements `handlePointerUp`/`handlePointerCancel` via DragTerminators
5. Implements `dispose()`

### Coordinator Configuration

```typescript
interface SheetCoordinatorConfig {
  initialSheetId: string;
  workbook: Workbook;                         // Unified Workbook API (required)
  platform?: Platform;                        // Keyboard platform for shortcuts
  getActiveSheetId?: () => string;            // Live getter for active sheet

  // Explicit feature flags
  enableKeyboard?: boolean;                   // Opt-in for keyboard handling

  // Action callbacks
  onUIAction?: (action: string) => void;
  onWorkbookAction?: (action: string) => void;
  onMetric?: (metric: Metric) => void;

  // Feature-specific dependency bundles
  clipboardDependencies?: ClipboardDependencies;
  editorDependencies?: EditorDependencies;
  sheetSwitchDependencies?: SheetSwitchDependencies;

  // Input configuration
  inputConfig?: Partial<InputCoordinatorConfig>;
}
```

### Coordinator Structure

The SheetCoordinator is a ~250-line composition root that creates 5 systems and wires cross-system events. All domain logic lives inside the systems. The coordinator only:

1. Creates systems with narrow configs
2. Calls `system.start()` in dependency order
3. Wires cross-system events
4. Implements `handlePointerUp`/`handlePointerCancel` via DragTerminators
5. Implements `dispose()`

```
apps/spreadsheet/src/coordinator/
├── sheet-coordinator.ts        # Main composition root (~250 lines)
├── shell-coordinator.ts        # Shell-level coordinator
├── factory.ts                  # Coordinator factory
├── types.ts                    # Config and dependency types
├── connector-rerouting.ts      # Connector re-routing wiring
├── actor-access/               # Actor access layer
├── features/                   # Cross-system feature coordination
├── mutations/                  # Document mutations
├── sparklines/                 # Sparkline coordination
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

  dispose(): void;
}
```

Actors are accessed through the systems, e.g. `coordinator.grid.access.actors.selection`.

## React Hooks

**Directory:** `apps/spreadsheet/src/hooks/` (organized by domain subdirectory)

| Hook                    | Directory       | Purpose                        |
| ----------------------- | --------------- | ------------------------------ |
| `useSelection`          | `selection/`    | Selection state and actions    |
| `useActiveCell`         | `selection/`    | Active cell state              |
| `useGranularSelection`  | `selection/`    | Fine-grained selection state   |
| `useEditor`             | `editing/`      | Cell editing state and actions |
| `useClipboard`          | `editing/`      | Copy/cut/paste operations      |
| `useRenderer`           | `view/`         | Renderer state and lifecycle   |
| `useKeyboard`           | `navigation/`   | Keyboard event handling        |
| `useFocus`              | `navigation/`   | Focus management               |
| `useFindReplace`        | `navigation/`   | Find/replace dialog            |
| `useChart`              | `charts/`       | Chart interactions             |
| `useObjectInteraction`  | `objects/`      | Floating object interactions   |
| `useDiagram`           | `objects/`      | Diagram object interactions   |
| `useCellProperties`     | `settings/`     | Cell formatting properties     |
| `useActionDependencies` | `toolbar/`      | Action system dependencies     |

## React Component Integration

**File:** `apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx`

The component is simplified - just sends events and renders UI:

```typescript
function SpreadsheetGrid() {
  const renderer = useRenderer();
  const selection = useSelection();

  // Effect 1: Mount/unmount
  useEffect(() => {
    renderer.mount(container);
    return () => renderer.unmount();
  }, []);

  // Effect 2: Layout ready
  useEffect(() => {
    if (renderer.status === 'waitingForLayout') {
      renderer.layoutReady(width, height);
    }
  }, [renderer.status]);

  // Effect 3: Provide dependencies
  useEffect(() => {
    coordinator.setRendererDependencies({ ... });
  }, []);

  // Event handlers delegate to hooks
  const handleMouseDown = (e) => {
    const cell = renderer.getCoordinateSystem()?.viewportToCell({ x, y });
    if (cell) selection.onMouseDown(cell, e);
  };

  return <div ref={containerRef} onMouseDown={handleMouseDown} />;
}
```

## Canvas Layers

**Package:** `@mog/grid-renderer` at `canvas/grid-renderer/src/layers/`

Single canvas with logical layers drawn in z-order:

| Z-Index | Layer             | Purpose                                      |
| ------- | ----------------- | -------------------------------------------- |
| 0       | background        | Grid lines, alternating rows                 |
| 1       | cells             | Cell content, formatting                     |
| 1.25    | validationCircles | Circle Invalid Data indicators               |
| 1.5     | pageBreaks        | Page break preview lines                     |
| 2       | selection         | Selection boxes, range highlights            |
| 2.5     | traceArrows       | Formula auditing trace arrows                |
| 3       | remoteCursors     | Collaborator selections                      |
| 4       | ui                | Fill handle, marching ants, resize handles   |
| 5       | overlay           | Charts, images, floating elements            |
| 6       | stickyHeaders     | Sticky table headers (renders above overlay) |

See [Canvas & Layers](canvas.md) for details.

## File Structure

```
apps/spreadsheet/src/
├── coordinator/                       # Composition root (~250 lines)
│   ├── sheet-coordinator.ts           # Creates 5 systems, wires cross-system events
│   ├── shell-coordinator.ts           # Shell-level coordinator
│   ├── factory.ts                     # Coordinator factory
│   ├── types.ts                       # Config and dependency types
│   ├── actor-access/                  # Actor access layer
│   ├── features/                      # Cross-system feature coordination
│   └── mutations/                     # Document mutations
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
canvas/grid-renderer/                  # @mog/grid-renderer package
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
    ├── renderer/                      # Main renderer
    ├── cell/                          # Cell rendering
    ├── viewports/                     # Viewport management
    └── optimization/                  # Dirty tracking, caching

shell/src/machines/
└── focus-machine.ts                   # Focus machine (@mog/shell)
```

## Performance Targets

| Metric              | Target          |
| ------------------- | --------------- |
| Render FPS          | 60fps sustained |
| Edit latency        | < 16ms          |
| Time to interactive | < 100ms         |
| Memory growth       | < 5% per hour   |
