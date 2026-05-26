# State Hooks

**Low-level React hooks that wrap XState machines.**

## Why Two Hooks Directories?

This project has two hooks directories by design:

| Directory | Purpose | Layer |
| ----------------------------------- | ----------------------- | -------------- |
| `src/state/hooks/` (this directory) | XState machine wrappers | **LOW-LEVEL** |
| `src/hooks/` | Feature compositions | **HIGH-LEVEL** |

This is **intentional**, not duplication.

## Architecture

```
React Components
 │
 ▼
src/hooks/ ← HIGH-LEVEL: useToolbarActions, useGridKeyboard, etc.
(Feature hooks that compose ← Orchestrate multiple state hooks for specific features
 multiple state hooks)
 │
 ▼
src/state/hooks/ ← LOW-LEVEL: useSelection, useEditor, useClipboard, etc.
(This directory) ← Single source of truth for each state machine
 │
 ▼
SheetCoordinator ← Creates and manages XState actors
 │
 ▼
XState Machines ← Pure state transitions (selection-machine, editor-machine, etc.)
 │
 ▼
Yjs Document ← Persistent collaborative state
```

## Hooks in This Directory

| Hook | Wraps | Purpose |
| ---------------------- | -------------------------- | ------------------------------------ |
| `useCoordinator` | SheetCoordinator | Context provider, coordinator access |
| `useSelection` | selection-machine | Cell/range selection state |
| `useEditor` | editor-machine | Cell editing state |
| `useClipboard` | clipboard-machine | Copy/cut/paste operations |
| `useRenderer` | renderer-machine | Canvas lifecycle, rendering |
| `useFocus` | focus-machine | Focus layer management |
| `useInput` | input-machine | Scroll, zoom, pan, touch |
| `useObjectInteraction` | object-interaction-machine | Floating object manipulation |
| `useCellProperties` | (queries) | Cell property lookups |

## Usage Pattern

**State hooks follow this pattern:**

```typescript
export function useSelection: UseSelectionReturn {
 const coordinator = useCoordinator;
 const actor = coordinator.getSelectionActor;
 const state = useSelector(actor, (s) => s);

 // Actions send events to the machine
 const select = useCallback(
 (cell) => {
 actor.send({ type: 'SELECT_CELL', cell });
 },
 [actor],
 );

 return { activeCell: state.context.activeCell, ranges: state.context.ranges, select };
}
```

## Rules

1. **State hooks are the single source of truth** for selection, editing, and clipboard state
2. **Feature hooks (`src/hooks/`) must import from here** for these concerns
3. **Never bypass this layer** by accessing machines or UIStore directly for state-machine-managed concerns
4. **Store access is OK** for data mutations (setCellValue, setCellFormat) that aren't state machine concerns

## Examples

```typescript
// ✅ CORRECT: Feature hook composes state hooks
// src/hooks/use-toolbar-actions.ts
import { useSelection } from '../state/hooks/use-selection';
import { useCellProperties } from '../state/hooks/use-cell-properties';

export function useToolbarActions {
 const { activeCell, ranges } = useSelection;
 const { format } = useCellProperties(sheetId, activeCell.row, activeCell.col);
 // ...
}
```

```typescript
// ❌ WRONG: Feature hook bypasses state hooks
// Don't do this!
import { useUIStore } from '../state';

export function useToolbarActions {
 const selection = useUIStore((s) => s.selection); // ❌ Bypasses XState
 // ...
}
```

## See Also

- `docs/renderer/README.md` - Full architecture documentation
- `src/state/machines/` - XState machine definitions
- `src/state/coordinator/` - SheetCoordinator implementation
