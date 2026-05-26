/**
 * Input System - Shared Types
 *
 * Types shared between `types.ts` and the concrete input submodules
 * (e.g., keyboard-coordinator). Lives here to break the cycle where
 * `types.ts` references the coordinator class for IInputSystem and the
 * coordinator imports a narrow UIStore type from `types.ts`.
 */

// =============================================================================
// NARROW UI STORE INTERFACE (DAG: systems/ must not import ui-store/)
// =============================================================================

/**
 * Narrow interface describing ONLY the UIStore properties needed by the Input system.
 * Replaces direct import of UIState to satisfy DAG constraints.
 *
 * the legacy mode fields (`extendSelectionMode`,
 * `endMode`, `deactivateEndMode`) were removed. The input coordinator now
 * reads selection-mode state via `selectionActor.getSnapshot().context.modes`
 * and writes it via `commands.selection.setMode(...)`.
 */
export interface KeyboardUIStore {
  /** Check if paste options menu should show on Ctrl key release */
  shouldShowPasteOptionsOnCtrlUp: () => boolean;
  /** Open the paste options menu */
  openPasteOptionsMenu: () => void;
}
