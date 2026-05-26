/**
 * Cross-System Wiring for Integration Tests
 *
 * Replicates the exact cross-system event subscriptions from
 * SheetCoordinator.wireCrossSystemEvents() and the pointer-up/cancel
 * dispatch from SheetCoordinator.handlePointerUp/handlePointerCancel.
 *
 * These are standalone utility functions so they can be used by
 * SheetSimulator or directly in integration tests.
 *
 * @see coordinator/sheet-coordinator.ts - source of truth for wiring
 * @module systems/testing-foundation
 */

import type { IGridEditingSystem } from '../grid-editing/types';
import type { IInkSystem } from '../ink/types';
import type { IInputSystem } from '../input/types';
import type { IObjectSystem } from '../objects/types';
import type { IRenderSystem } from '../renderer/types';

// =============================================================================
// CROSS-SYSTEM WIRING
// =============================================================================

/**
 * Wire cross-system events exactly as SheetCoordinator.wireCrossSystemEvents() does.
 *
 * The 7 subscriptions:
 * 1. grid.onSelectionActive -> objects.notifyExternalSelectionActive
 * 2. objects.onObjectSelectionActive -> grid.notifyExternalSelectionActive()
 * 3. grid.onEditStart -> input.focusEditor
 * 4. grid.onEditEnd -> input.focusGrid
 * 5. grid.onStateChange -> renderer.invalidate('grid-state')
 * 6. objects.onStateChange -> renderer.invalidate('objects')
 * 7. ink.onStateChange -> renderer.invalidate('ink')
 *
 * Each subscription is conditional on the relevant systems being present.
 * Returns a cleanup function that unsubscribes all wiring.
 */
export function wireSystemsForTest(config: {
  grid?: IGridEditingSystem;
  input?: IInputSystem;
  renderer?: IRenderSystem;
  objects?: IObjectSystem;
  ink?: IInkSystem;
}): { cleanup: () => void } {
  const unsubs: Array<() => void> = [];

  // 1-2. Selection exclusivity (grid <-> objects)
  if (config.grid && config.objects) {
    unsubs.push(
      config.grid.onSelectionActive(() => config.objects!.notifyExternalSelectionActive()),
    );
    unsubs.push(
      config.objects.onObjectSelectionActive(() => config.grid!.notifyExternalSelectionActive()),
    );
  }

  // 3-4. Editor-focus synchronization (grid -> input)
  if (config.grid && config.input) {
    unsubs.push(config.grid.onEditStart(() => config.input!.focusEditor()));
    unsubs.push(config.grid.onEditEnd(() => config.input!.focusGrid()));
  }

  // 5-7. Render invalidation (grid/objects/ink -> renderer)
  if (config.renderer) {
    if (config.grid) {
      unsubs.push(config.grid.onStateChange(() => config.renderer!.invalidate('grid-state')));
    }
    if (config.objects) {
      unsubs.push(config.objects.onStateChange(() => config.renderer!.invalidate('objects')));
    }
    if (config.ink) {
      unsubs.push(config.ink.onStateChange(() => config.renderer!.invalidate('ink')));
    }
  }

  return {
    cleanup: () => {
      for (const unsub of unsubs) {
        unsub();
      }
    },
  };
}

// =============================================================================
// POINTER-UP / POINTER-CANCEL DISPATCH
// =============================================================================

/**
 * Replicates SheetCoordinator.handlePointerUp() exactly.
 * Dispatches endDrag to all systems' DragTerminators + clears input pointer.
 */
export function dispatchPointerUp(config: {
  grid?: IGridEditingSystem;
  objects?: IObjectSystem;
  renderer?: IRenderSystem;
  ink?: IInkSystem;
  input?: IInputSystem;
}): void {
  config.grid?.dragTerminator.endDrag();
  config.objects?.dragTerminator.endDrag();
  config.renderer?.pageBreakDragTerminator.endDrag();
  config.ink?.dragTerminator.endDrag();
  config.input?.clearActivePointerId();
}

/**
 * Replicates SheetCoordinator.handlePointerCancel() exactly.
 * Dispatches cancelDrag to all systems' DragTerminators + clears input pointer.
 */
export function dispatchPointerCancel(config: {
  grid?: IGridEditingSystem;
  objects?: IObjectSystem;
  renderer?: IRenderSystem;
  ink?: IInkSystem;
  input?: IInputSystem;
}): void {
  config.grid?.dragTerminator.cancelDrag();
  config.objects?.dragTerminator.cancelDrag();
  config.renderer?.pageBreakDragTerminator.cancelDrag();
  config.ink?.dragTerminator.cancelDrag();
  config.input?.clearActivePointerId();
}
