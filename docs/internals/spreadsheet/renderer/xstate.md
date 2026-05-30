# XState Patterns & Integration

## Overview

Every complex interaction is modeled as an **explicit XState state machine**. Machines are pure TypeScript, testable without React or DOM. The **coordinator pattern** handles cross-machine communication, and **Rust/Yrs CRDT integration** makes collaboration a first-class concern.

## Why XState

| Approach              | Verdict  | Reasoning                                                          |
| --------------------- | -------- | ------------------------------------------------------------------ |
| **XState v5**         | Chosen   | Battle-tested, TypeScript-first, visualizer, time-travel debugging |
| Zustand + custom      | Rejected | Manual state machine enforcement, easy to violate invariants       |
| Custom implementation | Rejected | Reinventing wheels, edge cases in guards/actions/async             |

**Key benefits:**

- Type-safe states, events, and context
- [Stately visualizer](https://stately.ai/viz) for debugging
- First-class support for spawning child machines
- Used by Netflix, Microsoft, AWS Console

## Machine Definition Pattern

```typescript
// apps/spreadsheet/src/systems/grid-editing/machines/grid-selection-machine.ts
import { setup, assign } from 'xstate';

// 1. Define context (data that persists across states)
interface SelectionContext {
  anchor: CellRef | null;
  ranges: CellRange[];
  activeCell: CellRef;
}

// 2. Define events (all possible inputs)
type SelectionEvent =
  | { type: 'MOUSE_DOWN'; cell: CellRef; shiftKey: boolean; ctrlKey: boolean }
  | { type: 'MOUSE_MOVE'; cell: CellRef }
  | { type: 'MOUSE_UP' }
  | { type: 'ENTER_FORMULA_RANGE_MODE'; color: string }
  | { type: 'RESET' };

// 3. Define the machine with setup() for type inference
export const selectionMachine = setup({
  types: {
    context: {} as SelectionContext,
    events: {} as SelectionEvent
  },
  actions: {
    setAnchor: assign({ anchor: (_, event) => event.cell }),
    addRange: assign({ ranges: (ctx, event) => [...ctx.ranges, event.range] })
  },
  guards: {
    isShiftClick: (_, event) => event.shiftKey,
    isCtrlClick: (_, event) => event.ctrlKey
  }
}).createMachine({
  id: 'selection',
  initial: 'idle',
  context: { anchor: null, ranges: [], activeCell: { row: 0, col: 0 } },
  states: {
    idle: {
      on: {
        MOUSE_DOWN: [
          { guard: 'isShiftClick', target: 'extending' },
          { guard: 'isCtrlClick', target: 'multiSelecting' },
          { target: 'selecting', actions: 'setAnchor' }
        ]
      }
    },
    selecting: {
      /* ... */
    },
    extending: {
      /* ... */
    },
    multiSelecting: {
      /* ... */
    }
  }
});
```

## Coordinator Pattern

**Core Rule: Machines never import each other.**

All cross-machine communication goes through the coordinator.

```typescript
// WRONG - Direct coupling
import { selectionMachine } from './selection-machine';
onEnterFormulaEditing: () => {
  selectionMachine.send({ type: 'ENTER_FORMULA_RANGE_MODE' });
};

// CORRECT - Coordinator mediates
// apps/spreadsheet/src/systems/grid-editing/coordination/cross-coordination.ts
editorActor.subscribe((state) => {
  if (state.matches('formulaEditing') && !prevState.matches('formulaEditing')) {
    selectionActor.send({ type: 'ENTER_FORMULA_RANGE_MODE', color: state.context.rangeColor });
  }
});
```

### SheetCoordinator

**File:** `apps/spreadsheet/src/coordinator/sheet-coordinator.ts`

The SheetCoordinator is a ~250-line **composition root** that creates 5 systems and wires cross-system events. All domain logic lives inside the systems. The coordinator only:

1. Creates systems with narrow configs
2. Calls `system.start()` in dependency order
3. Wires cross-system events (via `wireCrossSystemEvents()`)
4. Implements `handlePointerUp`/`handlePointerCancel` via DragTerminators
5. Implements `dispose()`

```typescript
class SheetCoordinator {
  // The 5 systems (public readonly)
  readonly grid: IGridEditingSystem;      // Selection, editing, clipboard
  readonly renderer: IRenderSystem;        // Canvas rendering and lifecycle
  readonly objects: IObjectSystem;         // Charts, images, shapes, diagrams
  readonly input: IInputSystem;            // Mouse, touch, wheel, keyboard
  readonly ink: IInkSystem;                // Ink drawing

  // Focus actor from @mog/shell (shared focus stack)
  private readonly focusActor: FocusActor;

  constructor(config: SheetCoordinatorConfig) {
    // 1. Build shared infrastructure (FloatingObjectCache, etc.)
    // 2. Create the 5 systems with narrow configs
    // 3. Start systems in dependency order
    // 4. Wire cross-system events
  }

  // Late-arriving dependencies (React layer -> systems)
  setRendererDependencies(deps: RendererDependencies): void;

  dispose(): void;
}
```

### System Architecture

Each system owns its own machines, actors, and domain logic. The coordinator only wires cross-system events.

| System             | Directory                      | Machines                                                                  |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------- |
| **GridEditing**    | `systems/grid-editing/`        | grid-selection, grid-editor, clipboard, find-replace, comment, draw-border, slicer |
| **Input**          | `systems/input/`               | grid-input, pane-focus                                                    |
| **Renderer**       | `systems/renderer/`            | grid-renderer, page-break                                                 |
| **Objects**        | `systems/objects/`             | chart, object-interaction, diagram                                       |
| **Ink**            | `systems/ink/`                 | ink                                                                       |
| *(from @mog/shell)* | `shell/src/machines/`         | focus                                                                     |

### Cross-Coordination Rules

Cross-system events are wired in `SheetCoordinator.wireCrossSystemEvents()`. Within a system, cross-machine coordination is handled internally (e.g., `systems/grid-editing/coordination/`).

| Source            | Trigger                       | Target            | Action                      |
| ----------------- | ----------------------------- | ----------------- | --------------------------- |
| Editor            | enters `formulaEditing`       | Selection         | ENTER_FORMULA_RANGE_MODE    |
| Editor            | exits `formulaEditing`        | Selection         | EXIT_FORMULA_RANGE_MODE     |
| Selection         | range changes in formula mode | Editor            | FORMULA_RANGE_SELECTED      |
| Editor            | COMMIT with direction         | Selection         | SET_SELECTION               |
| Any               | state change                  | Renderer          | INVALIDATE layer            |
| Clipboard         | hasCut state                  | Renderer          | INVALIDATE ui layer         |
| FindReplace       | match found                   | Selection         | SET_SELECTION               |
| FindReplace       | mode activated                | Editor            | CANCEL (exit editing)       |
| ObjectInteraction | object selected               | Selection         | CLEAR (deselect cells)      |
| Chart             | chart selected                | ObjectInteraction | OBJECT_SELECT               |
| Selection         | table resize handle drag      | Renderer          | INVALIDATE table layer      |
| Input             | scroll gesture                | Renderer          | SCROLL                      |
| Validation        | circles toggled               | Renderer          | INVALIDATE validation layer |
| PageBreak         | break dragged                 | Renderer          | INVALIDATE page breaks      |
| Sparkline         | data changed                  | Renderer          | INVALIDATE sparkline cells  |
| CF                | rules changed                 | Renderer          | INVALIDATE affected range   |

### Cross-System Wiring Examples

From `SheetCoordinator.wireCrossSystemEvents()`:

- **Selection context exclusivity**: grid `onSelectionActive` notifies objects to deselect, and vice versa
- **Editor-focus sync**: grid `onEditStart` / `onEditEnd` tells input system to focus editor / grid
- **Render invalidation**: grid, objects, and ink `onStateChange` all trigger `renderer.invalidate()`
- **Sheet switch**: saves/restores view state (selection + scroll) when active sheet changes
- **Named ranges**: recalculates dependent formulas on name CRUD events

## Rust/Yrs CRDT Integration

**Core Rule: Remote updates are first-class events.**

Every state machine handles `REMOTE_*` events explicitly:

```typescript
type EditorEvent =
  | { type: 'START_EDITING'; cell: CellRef }
  | { type: 'INPUT'; value: string }
  | { type: 'COMMIT' }
  | { type: 'REMOTE_CELL_CHANGED'; cell: CellRef; newValue: unknown } // Another user
  | { type: 'REMOTE_CELL_DELETED'; cell: CellRef }
  | { type: 'REMOTE_SHEET_DELETED'; sheetId: string };
```

### Collaboration Integration

Collaboration is integrated through the coordinator's cross-system wiring and the workbook API. Remote events from Rust/Yrs are surfaced as first-class machine events (`REMOTE_*`) through the workbook's event system.

### Awareness Sync

Awareness synchronization is handled within the collaboration feature module:

```typescript
interface AwarenessState {
  user: { id: string; name: string; color: string };
  cursor: { selection: CellRange[]; activeCell: CellRef; sheetId: string } | null;
  editing: { cell: CellRef; sheetId: string } | null;
}
```

### Conflict Resolution

| Scenario                         | Resolution             | UI Feedback                 |
| -------------------------------- | ---------------------- | --------------------------- |
| Both editing same cell           | Last write wins (CRDT) | "Also being edited by X"    |
| Remote deletes cell being edited | Cancel local edit      | Toast "Cell deleted by X"   |
| Cut cells modified remotely      | Convert cut to copy    | Marching ants stop          |
| Selection conflicts              | No conflict            | Each user has own selection |

## Undo/Redo Boundary

Two state systems with different undo semantics:

| System     | Purpose                | Shared? | Has Undo?         |
| ---------- | ---------------------- | ------- | ----------------- |
| **Rust/Yrs** | Document state (data)  | Yes     | Yes (Yrs UndoManager) |
| **XState** | Interaction state (UI) | No      | No                |

**Document State (Rust/Yrs) - Undo-able:**

- Cell values, formulas, formatting
- Row/column structure
- Sheet structure
- Merged cells

**Session State (XState) - NOT Undo-able:**

- Selection position
- Clipboard state
- Editor buffer
- Scroll position

**This matches Excel/Sheets behavior:** Ctrl+Z after moving selection does NOT return selection.

## React Hooks

**Directory:** `apps/spreadsheet/src/hooks/` (organized by domain subdirectory)

Thin wrappers around XState actors:

```typescript
export function useSelection() {
  const coordinator = useCoordinator();
  const [state, send] = useActor(coordinator.getSelectionActor());

  return {
    // State
    ranges: state.context.ranges,
    activeCell: state.context.activeCell,
    isSelecting: state.matches('selecting'),

    // Actions
    onMouseDown: (cell, e) => send({ type: 'MOUSE_DOWN', cell, ... }),
    onMouseMove: (cell) => send({ type: 'MOUSE_MOVE', cell }),
    onMouseUp: () => send({ type: 'MOUSE_UP' }),
  };
}
```

**Available hooks:**

| Hook                      | Purpose                           |
| ------------------------- | --------------------------------- |
| `useSelection()`          | Selection state and actions       |
| `useEditor()`             | Editor state and actions          |
| `useClipboard()`          | Clipboard state and actions       |
| `useRenderer()`           | Renderer state and actions        |
| `useInput()`              | Input/scroll state and actions    |
| `useFocus()`              | Focus layer management            |
| `useChart()`              | Chart interaction state           |
| `useFindReplace()`        | Find/replace state and actions    |
| `useObjectInteraction()`  | Floating object interaction state |
| `useKeyboard()`           | Keyboard event handling           |
| `useCollaboration()`      | Remote user awareness             |
| `useActiveCell()`         | Active cell computed state        |
| `useCellProperties()`     | Cell property subscriptions       |
| `useGranularSelection()`  | Fine-grained selection updates    |
| `useActionDependencies()` | Action dependency tracking        |
| `usePrintSettings()`      | Print settings state              |

## State Machines

State machines are distributed across the 5 systems in `apps/spreadsheet/src/systems/`. Machines are pure TypeScript, testable without React or DOM. The focus machine comes from `@mog/shell`.

### Machine Locations

```
apps/spreadsheet/src/systems/
├── grid-editing/machines/
│   ├── grid-selection-machine.ts     # Cell/range selection
│   ├── selection/                    # Selection machine modules
│   │   ├── types.ts, events.ts, guards.ts, derived-state.ts
│   │   ├── core-actions.ts, mouse-actions.ts, keyboard-actions.ts
│   │   ├── page-actions.ts, system-actions.ts, helpers.ts
│   │   ├── formula-mode.ts, formula-actions.ts
│   │   ├── fill-handle.ts, header-selection.ts, header-resize.ts
│   │   ├── header-actions.ts, cell-drag-drop.ts, drag-actions.ts
│   │   └── table-resize.ts
│   ├── grid-editor-machine.ts        # Cell editing
│   ├── editor/                       # Editor machine modules
│   │   ├── types.ts, events.ts, guards.ts, core-actions.ts
│   │   ├── cursor-movement.ts, formula-editing.ts
│   │   ├── autocomplete.ts, picker.ts, rich-text.ts
│   │   └── index.ts
│   ├── clipboard-machine.ts          # Cut/copy/paste operations
│   ├── find-replace-machine.ts       # Find/replace operations
│   ├── comment-machine.ts            # Comment handling
│   ├── draw-border-machine.ts        # Draw border tool
│   └── slicer-machine.ts             # Slicer interactions
│
├── input/machines/
│   ├── grid-input-machine.ts         # Scroll/zoom gestures
│   ├── input-types.ts                # Input machine types
│   └── pane-focus-machine.ts         # F6 pane navigation
│
├── renderer/machines/
│   ├── grid-renderer-machine.ts      # Render invalidation
│   └── page-break-machine.ts         # Page break interactions
│
├── objects/machines/
│   ├── chart-machine.ts              # Chart interactions
│   ├── object-interaction-machine.ts # Floating object interactions
│   └── diagram-machine.ts           # Diagram object interactions
│
└── ink/machines/
    └── machine.ts                    # Ink drawing state

shell/src/machines/
└── focus-machine.ts                  # Focus layer stack (@mog/shell)
```

### State Machines Reference

| Machine            | System       | File                            | Purpose                                   |
| ------------------ | ------------ | ------------------------------- | ----------------------------------------- |
| Selection          | grid-editing | `grid-selection-machine.ts`     | Cell/range selection, multi-select        |
| Editor             | grid-editing | `grid-editor-machine.ts`        | Cell editing, formula entry               |
| Clipboard          | grid-editing | `clipboard-machine.ts`          | Cut/copy/paste state                      |
| Find/Replace       | grid-editing | `find-replace-machine.ts`       | Find/replace dialog state                 |
| Comment            | grid-editing | `comment-machine.ts`            | Comment popover, editing                  |
| Draw Border        | grid-editing | `draw-border-machine.ts`        | Border drawing tool                       |
| Slicer             | grid-editing | `slicer-machine.ts`             | Slicer selection and filtering            |
| Input              | input        | `grid-input-machine.ts`         | Scroll, zoom, pan gestures                |
| Pane Focus         | input        | `pane-focus-machine.ts`         | F6 pane cycling for freeze panes          |
| Renderer           | renderer     | `grid-renderer-machine.ts`      | Render invalidation tracking              |
| Page Break         | renderer     | `page-break-machine.ts`         | Page break drag in preview mode           |
| Chart              | objects      | `chart-machine.ts`              | Chart selection, editing, creation wizard |
| Object Interaction | objects      | `object-interaction-machine.ts` | Floating object move/resize               |
| Diagram           | objects      | `diagram-machine.ts`           | Diagram object interactions              |
| Ink                | ink          | `machine.ts`                    | Ink drawing state                         |
| Focus              | @mog/shell   | `focus-machine.ts`              | Focus layer stack management              |

## File Structure Summary

```
apps/spreadsheet/src/
├── coordinator/                      # Composition root
│   ├── sheet-coordinator.ts          # ~250-line composition root
│   ├── shell-coordinator.ts          # Shell-level coordinator
│   ├── factory.ts                    # createSheetCoordinator factory
│   ├── types.ts                      # Config and dependency types
│   ├── actor-access/                 # Actor access layer
│   ├── features/                     # Cross-system feature wiring
│   ├── mutations/                    # Document mutations
│   └── sparklines/                   # Sparkline coordination
│
├── systems/                          # Domain logic (5 systems)
│   ├── grid-editing/                 # Selection, editing, clipboard
│   │   ├── grid-editing-system.ts
│   │   ├── machines/                 # 7 machines + submodules
│   │   ├── coordination/            # Cross-machine coordination
│   │   ├── features/                # Feature-specific logic
│   │   └── subscriptions/           # Event subscriptions
│   ├── input/                        # Mouse, touch, wheel, keyboard
│   │   ├── input-system.ts
│   │   └── machines/                # 2 machines
│   ├── renderer/                     # Canvas rendering
│   │   ├── render-system.ts
│   │   └── machines/                # 2 machines
│   ├── objects/                      # Charts, images, shapes
│   │   ├── object-system.ts
│   │   └── machines/                # 3 machines
│   ├── ink/                          # Ink drawing
│   │   ├── ink-system.ts
│   │   └── machines/                # 1 machine
│   └── shared/                       # Shared types and utilities
│
└── hooks/                            # React hooks (by domain)
    ├── selection/                    # use-selection, use-active-cell, etc.
    ├── editing/                      # use-editor, use-clipboard, etc.
    ├── navigation/                   # use-keyboard, use-focus, etc.
    ├── view/                         # use-renderer, use-page-breaks, etc.
    ├── objects/                      # use-object-interaction, use-diagram
    ├── charts/                       # use-chart, use-charts
    ├── settings/                     # use-cell-properties, etc.
    ├── toolbar/                      # use-action-dependencies, etc.
    └── ...
```
