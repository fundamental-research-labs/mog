/**
 * Keyboard Test Utilities
 *
 * Factory utilities for keyboard dispatch testing.
 * Creates KeyboardEvent-like objects and KeyboardCoordinatorDependencies stubs
 * matching the shape wired in production (
 *
 * @see keyboard-coordinator.ts for the KeyboardCoordinatorDependencies interface
 */

import { jest } from '@jest/globals';
import type { KeyboardCoordinatorDependencies } from '../keyboard/keyboard-coordinator';

// =============================================================================
// KeyboardEvent Factory
// =============================================================================

/**
 * Create a KeyboardEvent-like object for testing.
 *
 * Uses `code` (physical key) as the primary identifier, matching how
 * KeyboardCoordinator normalizes events via `eventToBindingString()`.
 *
 * @param code - Physical key code (e.g., 'KeyB', 'ArrowDown', 'Enter')
 * @param options - Optional overrides for event properties
 * @returns A KeyboardEvent-compatible object (cast via `as unknown as KeyboardEvent`)
 */
export function createKeyEvent(
  code: string,
  options?: {
    key?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    repeat?: boolean;
    isComposing?: boolean;
    keyCode?: number;
  },
): KeyboardEvent {
  return {
    code,
    key: options?.key ?? code.replace('Key', ''),
    ctrlKey: options?.ctrlKey ?? false,
    metaKey: options?.metaKey ?? false,
    shiftKey: options?.shiftKey ?? false,
    altKey: options?.altKey ?? false,
    repeat: options?.repeat ?? false,
    isComposing: options?.isComposing ?? false,
    keyCode: options?.keyCode ?? 0,
  } as unknown as KeyboardEvent;
}

// =============================================================================
// KeyboardCoordinatorDependencies Factory
// =============================================================================

/**
 * Options for configuring the stub KeyboardCoordinatorDependencies.
 */
export interface CreateKeyboardDepsOptions {
  /** Editor machine state: controls what `editorActor.getSnapshot().matches()` returns */
  editorState?: 'idle' | 'editing' | 'formulaEditing' | 'imeComposing';
  /** Whether the editor is in Edit Mode (F2) vs Enter Mode */
  isEditMode?: boolean;
  /** Whether floating objects are selected */
  hasObjectSelection?: boolean;
  /** Whether editing text within a floating object */
  isEditingObjectText?: boolean;
  /** Whether F8 extend selection mode is active */
  extendSelectionMode?: boolean;
  /** Whether End mode is active */
  endMode?: boolean;
}

/**
 * Create a KeyboardCoordinatorDependencies with stub actors.
 *
 * All actor snapshots are minimal stubs that return configurable state.
 * The `dispatch` field is a `jest.fn()` spy that returns `{ handled: true }`.
 * The `createAccessLayer` returns empty accessors/commands stubs.
 *
 * This matches the dependency shape wired in production.
 *
 * @param options - Configuration for actor states and UI store
 * @returns A complete KeyboardCoordinatorDependencies object
 */
export function createKeyboardDeps(
  options?: CreateKeyboardDepsOptions,
): KeyboardCoordinatorDependencies {
  const editorState = options?.editorState ?? 'idle';
  const isEditMode = options?.isEditMode ?? false;
  const hasObjectSelection = options?.hasObjectSelection ?? false;
  const isEditingObjectText = options?.isEditingObjectText ?? false;
  const extendSelectionMode = options?.extendSelectionMode ?? false;
  const endMode = options?.endMode ?? false;

  // Stub editor actor with configurable snapshot
  const editorActor = {
    getSnapshot: () => ({
      matches: (state: string) => state === editorState,
      context: { isEditMode },
    }),
    send: jest.fn(),
    subscribe: jest.fn(),
  } as any;

  // selection-mode flags live exclusively on the
  // selection actor (`ctx.modes.{end,extend,additive}`); the legacy uiStore
  // mode-flag back-compat that propagated `endMode` / `extendSelectionMode`
  // into BOTH this snapshot AND the uiStore stub was retired alongside the
  // UIStore slice. The coordinator's `resolveSelectionAction` reads this
  // snapshot to route Arrow / Home keys under End / Extend mode. Tests
  // that drive End / Extend behavior set `endMode` / `extendSelectionMode`
  // on the options object; this stub propagates them into the selection-
  // actor snapshot only. SET_MODE events sent by the coordinator (e.g.
  // End auto-deactivation after a navigation) are recorded on
  // `selectionActor.send` but do not mutate the snapshot — tests assert
  // on `.send` call args instead.
  const selectionActor = {
    getSnapshot: () => ({
      matches: () => false,
      context: {
        modes: {
          end: endMode,
          extend: extendSelectionMode,
          additive: false,
        },
      },
    }),
    send: jest.fn(),
    subscribe: jest.fn(),
  } as any;

  // Stub clipboard actor
  const clipboardActor = {
    getSnapshot: () => ({
      matches: () => false,
      context: {},
    }),
    send: jest.fn(),
    subscribe: jest.fn(),
  } as any;

  // Stub chart actor
  const chartActor = {
    getSnapshot: () => ({
      matches: () => false,
      context: {},
    }),
    send: jest.fn(),
    subscribe: jest.fn(),
  } as any;

  // Stub object interaction actor
  const objectInteractionActor = {
    getSnapshot: () => ({
      matches: () => false,
      context: {},
    }),
    send: jest.fn(),
    subscribe: jest.fn(),
  } as any;

  // Stub find-replace actor
  const findReplaceActor = {
    getSnapshot: () => ({
      matches: () => false,
      context: {},
    }),
    send: jest.fn(),
    subscribe: jest.fn(),
  } as any;

  // Stub comment actor
  const commentActor = {
    getSnapshot: () => ({
      matches: () => false,
      context: {},
    }),
    send: jest.fn(),
    subscribe: jest.fn(),
  } as any;

  // Stub pane focus actor
  const paneFocusActor = {
    getSnapshot: () => ({
      matches: () => false,
      context: { currentPane: 'grid' },
    }),
    send: jest.fn(),
    subscribe: jest.fn(),
  } as any;

  // Mock UI store (zustand-compatible). the legacy
  // selection-mode fields (`extendSelectionMode` / `endMode` /
  // `deactivateEndMode`) are no longer part of KeyboardUIStore — they
  // live on the selection actor instead.
  const uiStore = {
    getState: () => ({
      shouldShowPasteOptionsOnCtrlUp: () => false,
      openPasteOptionsMenu: jest.fn(),
    }),
    setState: jest.fn(),
    subscribe: jest.fn(),
    destroy: jest.fn(),
  } as any;

  // Recording dispatch spy
  const dispatch = jest.fn().mockReturnValue({ handled: true });

  return {
    workbook: {} as any,
    selectionActor,
    editorActor,
    clipboardActor,
    objectInteractionActor,
    chartActor,
    findReplaceActor,
    commentActor,
    paneFocusActor,
    getActiveSheetId: () => 'sheet1',
    hasObjectSelection: () => hasObjectSelection,
    isEditingObjectText: () => isEditingObjectText,
    uiStore,
    getCoordinator: () => ({}) as any,
    dispatch,
    createAccessLayer: () => ({ accessors: {} as any, commands: {} as any }),
    // required deps. Tests don't exercise file I/O or
    // document lifecycle from the keyboard path, so the stubs are minimal.
    platform: {} as any,
    shellService: {} as any,
  };
}
