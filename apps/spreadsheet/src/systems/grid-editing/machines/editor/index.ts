/**
 * Editor Machine Module
 *
 * Barrel export file for the decomposed editor machine.
 * External consumers should import from this file to access editor machine functionality.
 *
 * This file re-exports:
 * - The main editor machine and its actor types
 * - Type definitions (context, events, entry modes)
 * - Event factory functions
 * - Guards and actions (for testing and advanced use cases)
 *
 * @example
 * ```ts
 * import { editorMachine, type EditorActor, type EditorContext } from './editor';
 * import { EditorEvents } from './editor';
 * import { coreActions, cursorMovementActions } from './editor';
 * ```
 */

// =============================================================================
// MACHINE
// =============================================================================

export {
  editorMachine,
  type EditorActor,
  type EditorMachine,
  type EditorState,
} from '../grid-editor-machine';

// =============================================================================
// TYPES
// =============================================================================

export { initialEditorContext } from './types';
export type { EditorContext, EditorEntryMode, EditorEvent } from './types';

// =============================================================================
// EVENTS
// =============================================================================

export { EditorEvents } from './events';

// =============================================================================
// GUARDS
// =============================================================================

// Guards are typically only used internally by the machine.
// Exported for testing and advanced use cases.
export { editorGuards } from './guards';

// =============================================================================
// ACTIONS
// =============================================================================

// Actions are typically only used internally by the machine.
// Exported for testing and advanced use cases.
export { autocompleteActions } from './autocomplete';
export { coreActions } from './core-actions';
export { cursorMovementActions } from './cursor-movement';
export { formulaEditingActions } from './formula-editing';
export { pickerActions } from './picker';
export { richTextActions } from './rich-text';
