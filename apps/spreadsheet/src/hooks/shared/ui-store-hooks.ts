/**
 * UI Store Convenience Hooks
 *
 * Provides convenience hooks for common UI store state patterns.
 * These hooks wrap useUIStore with specific selectors for cleaner component code.
 *
 * @see shell/src/ui-store/index.ts for the full UIStore implementation
 */

import { useUIStore } from '../../infra/context';

// =============================================================================
// Conditional Formatting Dialog Hooks
// =============================================================================

/**
 * Get the CF dialog state.
 */
export function useCFDialog() {
  return useUIStore((s) => s.cfDialog);
}

/**
 * Check if the CF dialog is open.
 */
export function useIsCFDialogOpen() {
  return useUIStore((s) => s.cfDialog.isOpen);
}

/**
 * Get the current quick rule dialog type (or null if none open).
 */
export function useQuickRuleDialog() {
  return useUIStore((s) => s.cfDialog.quickRuleDialog);
}

/**
 * Check if the CF Rules Manager dialog is open.
 */
export function useIsRulesManagerOpen() {
  return useUIStore((s) => s.cfDialog.rulesManagerOpen);
}

// =============================================================================
// Data Validation Dialog Hooks
// =============================================================================

/**
 * Get the Data Validation dialog state.
 */
export function useDVDialog() {
  return useUIStore((s) => s.dvDialog);
}

/**
 * Check if the Data Validation dialog is open.
 */
export function useIsDVDialogOpen() {
  return useUIStore((s) => s.dvDialog.isOpen);
}
