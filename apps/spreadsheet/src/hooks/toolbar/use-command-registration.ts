/**
 * useCommandRegistration Hook
 *
 * Registers built-in commands with the command registry when mounted.
 * This enables the Command Palette (Ctrl+Shift+P) to show all available actions.
 *
 * Must be called from a component that has access to all action handlers
 * (typically ToolbarContainer, which is inside SpreadsheetCoordinatorProvider).
 *
 * @see Stream-H-FORMULA-BAR-COMMAND-PALETTE.md - & 5
 */

import { useEffect } from 'react';

import type { CommandActions } from '../../actions/commands/built-in-commands';
import {
  registerBuiltInCommands,
  unregisterBuiltInCommands,
} from '../../actions/commands/built-in-commands';

// =============================================================================
// Types
// =============================================================================

/**
 * All action handlers that can be registered as commands.
 * Extended from CommandActions with additional handlers available in ToolbarContainer.
 */
export interface CommandRegistrationActions extends CommandActions {
  // Additional handlers not in base CommandActions can be added here
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook that registers built-in commands with the command registry.
 *
 * Call this hook from ToolbarContainer (or similar) to enable the Command Palette.
 * Commands are automatically unregistered on unmount.
 *
 * @param actions - Object containing all action handler functions
 *
 * @example
 * ```tsx
 * function ToolbarContainer() {
 * const { handleBoldClick, handleUndo, ... } = useToolbarActions;
 *
 * useCommandRegistration({
 * toggleBold: handleBoldClick,
 * undo: handleUndo,
 * // ... etc
 * });
 *
 * return <TabbedToolbar ... />;
 * }
 * ```
 */
export function useCommandRegistration(actions: CommandRegistrationActions): void {
  useEffect(() => {
    // Register all commands with the registry
    registerBuiltInCommands(actions);

    // Cleanup: unregister on unmount
    return () => {
      unregisterBuiltInCommands();
    };
    // Note: We intentionally use a stable dependency here.
    // Actions object should be memoized by the caller if frequent re-registration
    // is a concern. In practice, handlers are stable due to useCallback.
  }, []);
}
