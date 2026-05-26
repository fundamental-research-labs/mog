# Selection Machine Module

This directory contains the decomposed selection state machine implementation. The selection machine manages all selection interactions in the spreadsheet including mouse clicks, keyboard navigation, fill handle operations, cell drag-drop, header resize, table resize, and formula range picking.

## Module Structure

The selection machine has been decomposed into focused modules for better maintainability:

```
selection/
 types.ts - Type definitions (context, events)
 events.ts - Event factory (SelectionEvents)
 guards.ts - Guard functions for state transitions
 core-actions.ts - Main export combining all action modules (182 lines)
 mouse-actions.ts - Mouse click and drag actions (127 lines)
 keyboard-actions.ts - Keyboard navigation actions (323 lines)
 page-actions.ts - Page navigation (Up/Down/Left/Right) (169 lines)
 system-actions.ts - System state management (180 lines)
 header-actions.ts - Column/row header selection (180 lines)
 formula-actions.ts - Formula range picker actions (95 lines)
 drag-actions.ts - Fill handle, drag-drop, resize ops (259 lines)
 derived-state.ts - Computed selection state and snapshots
 __tests__/ - Unit tests for each module
 README.md - This file
```

## File Purposes

### types.ts

Type definitions for the selection state machine:

- `SelectionContext` - The complete machine context including ranges, activeCell, anchors, fill handle state, drag state, resize state, etc.
- `SelectionEvent` - Union type of all events the machine handles
- Helper types for actions and guards

### events.ts

Type-safe event factory (`SelectionEvents`) for creating machine events:

- Prevents magic string drift by centralizing event creation
- Provides auto-complete for event parameters
- Example: `SelectionEvents.mouseDown(cell, shiftKey, ctrlKey)` instead of inline objects

### guards.ts

Pure guard functions for conditional state transitions:

- `isShiftClick`, `isCtrlClick` - Mouse modifier detection
- `isShiftArrow` - Keyboard modifier detection
- `isShiftColumnClick`, `isShiftRowClick` - Header selection modifiers
- `isFillHandleAllowed` - Settings-based guards
- Extended navigation guards (`isShiftCtrlArrow`, `isShiftHome`, etc.)

### core-actions.ts

Main export module that combines all action modules:

- Imports actions from all specialized modules
- Exports `selectionCoreActions` - combined object of all actions
- Exports `initialSelectionContext` - initial machine state
- Exports **Helper functions**:
 - `computeDirection` - Calculate selection direction from anchor to active
 - `extendLastRange` - Extend last range to new cell
 - `addRange` - Add new range to selection
 - `moveTo` - Move to cell and create single-cell selection
 - `getSelectAllRange` - Get bounds for select all

### mouse-actions.ts

Mouse interaction actions:

- `setAnchorAndSelect` - Single click (handles merged cells)
- `extendToCell` - Shift+click range extension
- `startMultiSelect` - Ctrl+click multi-selection
- `updateDragSelection` - Update during drag
- `finalizeDrag` - Normalize ranges on mouse up

### keyboard-actions.ts

Keyboard navigation actions:

- **Arrow keys**: `moveActiveCell`, `extendSelection`
- **Home/End**: `moveToHome`, `extendToHome`, `moveToEnd`, `extendToEnd`
- **Tab/Enter**: `moveTab`, `moveEnter`, `tabNavigate`
- **Direct**: `goToCell`, `selectAll`
- Re-exports page actions from `page-actions.ts`

**Note**: Ctrl+Arrow (data-edge navigation) is handled by the KeyboardCoordinator
which dispatches `MOVE_TO_EDGE_*` actions to handlers in `handlers/selection.ts`.
These handlers use `findDataEdge` algorithm for proper Excel-like behavior.

### page-actions.ts

Page navigation actions (Issue 8 Wave 2B):

- `pageUp`, `pageUpExtend` - Move/extend up by viewport height
- `pageDown`, `pageDownExtend` - Move/extend down by viewport height
- `pageLeft`, `pageLeftExtend` - Move/extend left by viewport width
- `pageRight`, `pageRightExtend` - Move/extend right by viewport width

### system-actions.ts

System state management actions:

- `setSelection` - Direct selection setting (with anchor support)
- `resetSelection` - Reset to initial state
- `updateSettings` - Update settings from coordinator
- `setVisibilityCallbacks` - Hidden row/col callbacks (L0.5)
- `adjustForStructureChange` - Adjust selection after row/col insert/delete (Issue 1)

### header-actions.ts

Column and row header selection actions:

- **Column**: `selectSingleColumn`, `addColumnToSelection`, `extendToColumn`, `extendColumnSelection`
- **Row**: `selectSingleRow`, `addRowToSelection`, `extendToRow`, `extendRowSelection`
- `finalizeHeaderSelection` - Complete header selection

### formula-actions.ts

Formula range selection mode actions:

- `enterFormulaMode` / `exitFormulaMode` - Toggle formula range picking
- `enterRangeSelectionMode` / `exitRangeSelectionMode` - For dialog range inputs
- `setFormulaRange` / `updateFormulaRange` - Track range during formula editing

### drag-actions.ts

Drag operation actions for fill handle, cell drag-drop, and resize:

- **Fill handle**: `startFillHandle`, `updateFillHandle`, `clearFillHandle`
- **Cell drag-drop**: `startDragCells`, `updateDragCells`, `clearDragCells`
- **Header resize**: `startColumnResize`, `startRowResize`, `updateResize`, `finalizeResize`, `clearResize`
- **Table resize**: `startTableResize`, `updateTableResize`, `finalizeTableResize`, `clearTableResize`

### derived-state.ts

Efficient computation of derived selection state:

- `computeDerivedSelectionState` - Calculates full row/column selection flags with caching
- `getSelectionSnapshot` - Extracts complete snapshot for hooks/consumers
- `SelectionSnapshotResult` - Type for the complete selection snapshot
- Optimizations: Avoids iterating 16K columns or 1M rows for full selections

## Dependency Hierarchy

The modules form a clear dependency hierarchy:

```
types.ts (no dependencies - defines contracts)
 ^
 |
guards.ts (depends on types)
 ^
 |
mouse-actions.ts (depends on types, imports helpers from core-actions)
keyboard-actions.ts (depends on types, imports helpers from core-actions)
page-actions.ts (depends on types, imports helpers from core-actions)
system-actions.ts (depends on types, imports helpers from core-actions)
header-actions.ts (depends on types, imports helpers from core-actions)
formula-actions.ts (depends on types)
drag-actions.ts (depends on types)
 ^
 |
core-actions.ts (imports and combines all action modules)
 ^
 |
events.ts (depends on types)
derived-state.ts (depends on types - for snapshot extraction)
 ^
 |
../selection-machine.ts (imports core-actions, guards, events)
```

**Key Points**:

- Action modules import helpers from `core-actions.ts`
- `keyboard-actions.ts` re-exports `page-actions.ts` for convenience
- `core-actions.ts` combines all modules and exports the unified `selectionCoreActions`
- Only `selection-machine.ts` imports from `core-actions.ts` (single source of truth)

## How to Add New Features

### Adding a New Event

1. Add the event type to `SelectionEvent` union in `types.ts`
2. Add an event factory method to `SelectionEvents` in `events.ts`
3. Add handler in the appropriate action file
4. Update `selection-machine.ts` state transitions if needed

### Adding a New Action

1. Determine which action file is appropriate (or create new one if needed)
2. Write the action using XState's `assign` pattern
3. Export the action in the actions object
4. Reference the action in `selection-machine.ts`

### Adding a New Guard

1. Add the guard function to `guards.ts`
2. Export it in the `selectionGuards` object
3. Reference by name in `selection-machine.ts` transitions

### Adding New Context Fields

1. Add the field to `SelectionContext` in `types.ts`
2. Add initial value to `initialSelectionContext` in `core-actions.ts`
3. Update `derived-state.ts` if the field needs to be in snapshots
4. Add relevant actions to manipulate the field

## Main State Machine Reference

The main state machine is defined in:

```
../selection-machine.ts
```

It imports all modules and creates the machine using XState's `setup`:

- All guards from `guards.ts`
- All actions from `core-actions.ts` (which also includes delegated actions)
- Initial context from `core-actions.ts`

The machine states include:

- `idle` - Static selection, waiting for input
- `selecting` - Mouse drag in progress
- `extending` - Shift+click range extension
- `multiSelecting` - Ctrl+click multi-selection
- `selectingColumn` / `selectingRow` - Header selection drag
- `draggingFillHandle` / `rightDraggingFillHandle` - Fill handle operations
- `draggingCells` - Cell move/copy drag
- `resizingHeader` - Column/row resize
- `resizingTable` - Table resize
- `selectingRangeForFormula` - Formula range picking mode

## Related Documentation

- `ARCHITECTURE.md` - State Machine 2: Selection overview
- `docs/architecture/features/1-ai-spreadsheet-architecture.md` - Feature context
