# XState Patterns & Integration

## Overview

Spreadsheet grid interaction state is modeled with **XState v5 state machines** owned by systems. Machine definitions are TypeScript modules that do not depend on React or the DOM; system and coordinator classes create actors, provide side-effect implementations, and wire cross-machine communication. Persistent collaborative document state lives in Rust/Yrs-backed compute and workbook APIs, while XState owns local UI/session state.

## Status and Scope

This is a **workspace-internal** architecture note for `@mog/app-spreadsheet` and related private/reserved packages. It is not a public integration guide and does not describe a supported external API for constructing grid actors directly.

- `@mog/app-spreadsheet` is a private workspace app package.
- `@mog/shell` is a reserved private package; its focus machine is consumed inside the monorepo.
- Public setup paths are the facades listed in package inventory, such as `@mog-sdk/sheet-view`, `@mog-sdk/embed`, `@mog-sdk/spreadsheet-app`, `@mog-sdk/node`, and `@mog-sdk/contracts`.
- The current spreadsheet app depends on `xstate` `^5.31.1` and `@xstate/react` `^6.1.0`; `pnpm-lock.yaml` currently resolves `xstate@5.31.1`.

## Why XState

| Approach              | Verdict                      | Reasoning                                                                                  |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| **XState v5**         | Used in workspace-internal UI | Grid, renderer, input, object, ink, and focus actors use XState; separate app views also define XState machines. |
| Zustand / UI store    | Complementary                | UI stores hold view/chrome state; machines enforce interaction invariants.                  |
| Custom implementation | Avoided for machine behavior | Machines rely on XState guards, actions, actor emissions, invoked actors, and typed snapshots. |

**Key benefits:**

- Type-safe states, events, and context
- Spreadsheet grid actors owned by systems/coordinators, not React components
- Hooks can subscribe to narrow XState snapshot slices with `@xstate/react`
- Side effects can be injected by systems while machine transitions stay explicit

## Machine Definition Pattern

```typescript
// apps/spreadsheet/src/systems/grid-editing/machines/grid-selection-machine.ts
import { setup, type ActorRefFrom } from 'xstate';

import type { SelectionContext, SelectionEmitted, SelectionEvent } from './selection/types';
import { selectionGuards } from './selection/guards';
import { initialSelectionContext, selectionCoreActions } from './selection/core-actions';

export const selectionMachine = setup({
  types: {
    context: {} as SelectionContext,
    events: {} as SelectionEvent,
    emitted: {} as SelectionEmitted,
  },
  guards: selectionGuards,
  actions: selectionCoreActions,
}).createMachine({
  id: 'selection',
  initial: 'idle',
  context: initialSelectionContext,
  on: {
    STRUCTURE_CHANGE: { actions: 'adjustForStructureChange' },
    SET_LAYOUT_CALLBACKS: { actions: 'setLayoutCallbacks' },
  },
  states: {
    idle: {
      on: {
        MOUSE_DOWN: [
          {
            guard: 'isShiftAndCtrlClick',
            target: 'multiSelecting',
            actions: ['startMultiSelectAndExtend', 'emitUserSelectionChanged'],
          },
          {
            guard: 'isShiftOnlyClick',
            target: 'extending',
            actions: ['extendToCell', 'emitUserSelectionChanged'],
          },
          {
            guard: 'isCtrlOnlyClick',
            target: 'multiSelecting',
            actions: ['startMultiSelect', 'emitUserSelectionChanged'],
          },
          { target: 'selecting', actions: ['setAnchorAndSelect', 'emitUserSelectionChanged'] },
        ],
      },
    },
    /* selecting, extending, multiSelecting, selectingRangeForFormula, ... */
  },
});

export type SelectionActor = ActorRefFrom<typeof selectionMachine>;
```

## Coordinator Pattern

**Core Rule: machine definitions never import each other.**

Cross-machine communication is centralized in system-level coordination modules or in `SheetCoordinator` wiring.

```typescript
// WRONG - hidden direct coupling from one machine implementation to another actor
editorActions.onEnterFormulaEditing = () => {
  selectionActor.send({ type: 'ENTER_FORMULA_RANGE_MODE' });
};

// CORRECT - Coordinator mediates
// apps/spreadsheet/src/systems/grid-editing/coordination/cross-coordination.ts
editorActor.subscribe((state) => {
  if (!wasFormulaEditing && state.matches('formulaEditing')) {
    selectionActor.send({
      type: 'ENTER_FORMULA_RANGE_MODE',
      color: state.context.currentRangeColor,
    });
  }
});
```

### SheetCoordinator

**File:** `apps/spreadsheet/src/coordinator/sheet-coordinator.ts`

The SheetCoordinator is the spreadsheet **workspace-internal composition root**. It creates the 5 grid systems, starts them in dependency order, owns the shared focus actor, and wires cross-system subscriptions. The current file also contains floating-object projection, active-cell cache refresh, flash fill hooks, named-range and merge-anchor wiring, find/replace wiring, receipt processing, sheet-switch coordination, and toolbar/cache wiring, so it is no longer a tiny wrapper.

1. Creates systems with narrow configs
2. Calls `system.start()` in dependency order
3. Wires cross-system events (via `wireCrossSystemEvents()`)
4. Implements `handlePointerUp`/`handlePointerCancel` via DragTerminators
5. Implements receipt processing and disposal

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

  handlePointerUp(): void;
  handlePointerCancel(): void;
  processReceipts(receipts: MutationReceipt[]): void;
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

Cross-system events are wired in `SheetCoordinator.wireCrossSystemEvents()`. Tightly coupled machines inside a system are wired in that system's `coordination/` and `features/` modules.

| Area                         | Wiring                                                                 |
| ---------------------------- | ---------------------------------------------------------------------- |
| Formula editing              | Editor state enters/exits formula mode -> selection formula range mode |
| Formula range insertion      | Selection changes in formula mode -> editor `FORMULA_RANGE_SELECTED`   |
| Commit navigation            | Editor commit transitions -> selection `KEY_TAB`, `KEY_ENTER`, or `SET_SELECTION` |
| Selection/object exclusivity | Grid selection activity deselects objects, and object activity resets cell selection |
| Editor focus                 | Grid edit start/end -> input focus editor/grid                         |
| Render invalidation          | Grid, objects, ink, find/replace, and feature coordination invalidate renderer work |
| Sheet switching              | Sheet switch coordination saves/restores selection and scroll state     |
| Structure-change machine handlers | Selection, editor, and clipboard define `STRUCTURE_CHANGE` handlers; renderer event subscriptions independently invalidate on row/column structure events |

`apps/spreadsheet/src/systems/grid-editing/features/structure/structure-coordination.ts` still exists and forwards workbook row/column events to selection, editor, and clipboard actors, but no current production setup call was found in the public app source. Treat that module as **workspace-internal, not currently wired** until a caller is added.

### Cross-System Wiring Examples

From `SheetCoordinator.wireCrossSystemEvents()`:

- **Selection context exclusivity**: grid `onSelectionActive` notifies objects to deselect, and vice versa
- **Editor-focus sync**: grid `onEditStart` / `onEditEnd` tells input system to focus editor / grid
- **Render invalidation**: grid, objects, and ink `onStateChange` trigger `renderer.invalidate()`
- **Viewport follow**: RenderSystem subscribes to the selection machine's `userSelectionChanged` emitted event and sends `SCROLL_TO_ACTIVE_CELL` only for local user-driven selection changes
- **Sheet switch**: saves/restores view state (selection + scroll) when active sheet changes
- **Named ranges**: recalculates dependent formulas on name CRUD events
- **Floating objects**: workbook floating-object events update the cache and push renderer patches

## Rust/Yrs CRDT Integration

**Core Rule: collaborative document state is handled below UI state.**

Persistent workbook state is backed by Rust/Yrs and reached through workbook/compute APIs. In this app, the direct kernel sidecar and workbook implementation are **workspace-internal**; public callers should use the public facades rather than importing `@mog-sdk/kernel` directly. Machines that need to react to remote or external changes define explicit events; not every machine has `REMOTE_*` events.

```typescript
// apps/spreadsheet/src/systems/grid-editing/machines/editor/types.ts
type EditorEvent =
  | { type: 'START_EDITING'; cell: CellCoord; sheetId: string; initialValue?: string }
  | { type: 'INPUT'; value: string; cursorPosition: number }
  | { type: 'COMMIT'; direction: Direction | 'none'; commitKey?: 'tab' | 'shift-tab' | 'enter' | 'shift-enter' }
  | { type: 'REMOTE_CELL_CHANGED'; cell: CellCoord; newValue: unknown }
  | { type: 'REMOTE_CELL_DELETED'; cell: CellCoord }
  | { type: 'REMOTE_SHEET_DELETED'; sheetId: string }
  | { type: 'REMOTE_SCHEMA_CHANGED'; cell: CellCoord }
  | {
      type: 'REMOTE_STRUCTURE_CHANGE';
      sheetId: string;
      operation: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns';
      startIndex: number;
      count: number;
    };
```

### Collaboration Integration

Collaboration is split across the workspace-internal kernel sidecar, workbook event subscriptions, and UI coordination. The app stores sidecar status and participant presence in `chrome/collab/use-collab-store.ts`; `useSelectionPresenceBroadcast()` broadcasts local selection; `useRemoteCursors()` converts remote participant presence into renderer cursors. Workbook events also feed renderer invalidation and object/chart cleanup paths, including floating-object deletion.

### Awareness Sync

Presence synchronization uses the workspace-internal kernel collaboration sidecar `PresenceState` shape, exported by the kernel API as `CollaborationPresenceState`:

```typescript
interface PresenceState {
  displayName: string;
  color: string;
  avatarUrl?: string;
  selection?: {
    sheetId: string;
    row: number;
    col: number;
    endRow?: number;
    endCol?: number;
  };
  editing?: {
    sheetId: string;
    row: number;
    col: number;
  };
}
```

### Conflict Resolution

| Machine       | Remote/external handling                                                                 |
| ------------- | ---------------------------------------------------------------------------------------- |
| Editor        | `REMOTE_CELL_CHANGED` sets `hasConflict`; remote deletion/sheet deletion reset with flags |
| Selection     | `REMOTE_SELECTION_CHANGED` is an intentional no-op; non-user `SET_SELECTION` does not emit viewport-follow |
| Clipboard     | `STRUCTURE_CHANGE` adjusts copied/cut ranges for row/column mutations                    |
| Objects/Chart | Object selection and chart deletion have explicit remote/external events                 |
| Slicer        | `REMOTE_UPDATE` refreshes slicer state                                                   |

## Undo/Redo Boundary

Two state systems with different undo semantics:

| System     | Purpose                | Shared? | Has Undo?         |
| ---------- | ---------------------- | ------- | ----------------- |
| **Rust compute/Yrs history** | Document state (data)  | Yes     | Yes, through `ComputeBridge` / `UndoService` |
| **XState**                  | Interaction state (UI) | No      | No                                      |

**Document State (Rust compute/Yrs) - Undo-able:**

- Cell values, formulas, formatting
- Row/column structure
- Sheet structure
- Merged cells

**Session State (XState) - NOT Undo-able:**

- Selection movement by itself
- Clipboard UI state
- Editor buffer
- Scroll position

**This matches Excel/Sheets behavior:** Ctrl+Z after moving selection does NOT return selection.

There is one important workspace-internal bridge: `setupUndoSelectionCoordination()` listens to workbook history changes and restores a selection checkpoint around document undo/redo operations. That restores UI context for undoable document mutations, but selection-only movement still does not create an undo step.

## React Hooks

**Directory:** `apps/spreadsheet/src/hooks/` (organized by domain subdirectory)

Thin wrappers around coordinator-owned actors:

```typescript
export function useSelection() {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;
  const snapshot = useSelector(actor, getSelectionSnapshot, selectionSnapshotEqual);
  const commands = coordinator.grid.access.commands.selection;

  return {
    ranges: snapshot.ranges,
    activeCell: snapshot.activeCell,
    isSelecting: snapshot.isSelecting,
    onMouseDown: (cell, shiftKey, ctrlKey) => commands.mouseDown(cell, shiftKey, ctrlKey),
    onMouseMove: (cell) => commands.mouseMove(cell),
    onMouseUp: () => commands.mouseUp(),
  };
}
```

**Available hooks:**

| Hook family                                                            | Purpose                           |
| ---------------------------------------------------------------------- | --------------------------------- |
| `useSelection()`, `useSelectionActions()`, `useActiveCell()`           | Selection state and actions       |
| `useSelectionRanges()`, `useSelectionSummary()`, `useSelectionModes()` | Fine-grained selection updates    |
| `useEditor()`, `useEditorState()`, `useEditorActions()`                | Editor state and actions          |
| `useClipboard()`                                                       | Clipboard state and actions       |
| `useRenderer()`, `useRendererStatus()`, `useRendererActions()`         | Renderer state and actions        |
| `useInputState()`, `useInputEventHandlers()`                           | Input/editor event handling       |
| `useFocus()`, `useKeyboard()`, `useFindReplace()`                      | Navigation and find/replace       |
| `useObjectInteraction()`, `useInk()`, `useDiagramUI()`                 | Floating object and ink state     |
| `useChartUI()`, `useCharts()`, `useChartEditorActions()`               | Chart interaction state           |
| `useCollabPresence()`, `useRemoteCursors()`                            | Remote user awareness             |
| `useCellProperties()`, `useActionDependencies()`, `usePrintSettings()` | Settings, toolbar, and print UI   |

These hooks are app-private React helpers under `apps/spreadsheet/src/hooks`. Public packages expose higher-level embed, app, and sheet-view APIs instead of this actor layer.

## State Machines

Grid state machines are distributed across the 5 systems in `apps/spreadsheet/src/systems/`. Machines are TypeScript modules without React dependencies. The focus machine comes from `@mog/shell`.

`apps/spreadsheet/src/systems/shared/actor-manager.ts` still exists for tests and older helper modules, but the production `SheetCoordinator` path shown above creates actors through the owning systems plus a coordinator-owned focus actor.

### Machine Locations

```
apps/spreadsheet/src/systems/
├── grid-editing/machines/
│   ├── grid-selection-machine.ts     # Cell/range selection
│   ├── selection/                    # Selection machine modules
│   │   ├── types.ts, events.ts, guards.ts, derived-state.ts, emits.ts
│   │   ├── core-actions.ts, mouse-actions.ts, keyboard-actions.ts
│   │   ├── page-actions.ts, system-actions.ts, drag-actions.ts
│   │   ├── header-actions.ts, formula-mode.ts, formula-actions.ts
│   │   └── cycle.ts, merge-escape.ts, helpers.ts
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
│   ├── sheet-coordinator.ts          # Composition root and cross-system wiring
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
    ├── collab/                       # useCollabPresence, useRemoteCursors
    ├── comments/                     # use-comments, use-comment-popover
    ├── data/                         # data feature hooks
    ├── file-io/                      # persistence, export, print
    ├── settings/                     # use-cell-properties, etc.
    ├── toolbar/                      # use-action-dependencies, etc.
    └── ...
```
