/**
 * Keyboard Hooks
 *
 * React hooks for unified keyboard handling in the Spreadsheet OS.
 * Moved from kernel to shell as part of the React extraction effort.
 *
 * @module shell/hooks/keyboard
 */

// Main keyboard hook
export { useKeyboard } from './use-keyboard';
export type { UseKeyboardOptions, UseKeyboardReturn } from './use-keyboard';

// Context derivation hook
export {
  isBlockingContext,
  isEditingContext,
  isFormulaEditingContext,
  supportsTypeToEdit,
  useKeyboardContext,
} from './use-keyboard-context';
export type { UseKeyboardContextOptions } from './use-keyboard-context';
