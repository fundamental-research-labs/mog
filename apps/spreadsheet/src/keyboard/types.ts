/**
 * Spreadsheet-owned keyboard shortcut contracts.
 *
 * Kernel owns keyboard infrastructure: physical keys, bindings, matcher,
 * processor, and action-agnostic shortcut shape. The spreadsheet app owns
 * the concrete shortcut contexts, categories, actions, and action payload
 * coupling used by its shortcut registry.
 */

import type {
  KeyboardShortcutBase as KernelKeyboardShortcutBase,
  MuscleMemoryLevel,
} from '@mog-sdk/kernel/keyboard';
import type { ActionType, KeyboardActionPayload } from '../actions';

/**
 * Contexts in which spreadsheet shortcuts can be active.
 */
export type ShortcutContext =
  | 'global'
  | 'grid'
  | 'flashFillPreview'
  | 'editing'
  | 'enterMode'
  | 'editMode'
  | 'formulaEnterMode'
  | 'formulaEditMode'
  | 'formulaEditing'
  | 'objectSelected'
  | 'dialog'
  | 'menu'
  | 'drawing'
  | 'diagramNodeSelected'
  | 'keyTipMode'
  | 'view'
  | 'kanban'
  | 'kanbanEditing'
  | 'gallery'
  | 'calendar'
  | 'timeline'
  | 'any';

/**
 * Spreadsheet shortcut groups used in help, customization, and conflict UI.
 */
export type ShortcutCategory =
  | 'navigation'
  | 'selection'
  | 'editing'
  | 'formatting'
  | 'clipboard'
  | 'formula'
  | 'comments'
  | 'data'
  | 'view'
  | 'file'
  | 'workbook'
  | 'object'
  | 'accessibility';

export type KeyboardShortcutBase<A extends ActionType = ActionType> = Omit<
  KernelKeyboardShortcutBase<A, ShortcutContext, ShortcutCategory>,
  'matchBy' | 'muscleMemory'
> & {
  readonly matchBy: 'key' | 'code';
  readonly muscleMemory: MuscleMemoryLevel;
};

/**
 * Spreadsheet shortcut definition with action-specific payload typing.
 */
export type KeyboardShortcut<A extends ActionType = ActionType> = A extends ActionType
  ? KeyboardShortcutBase<A> & {
      readonly action: A;
      readonly actionArg?: A extends keyof KeyboardActionPayload ? KeyboardActionPayload[A] : never;
    }
  : never;

export interface ShortcutMatchResult {
  readonly shortcut: KeyboardShortcut | null;
  readonly preventDefault: boolean;
}

export type ShortcutHandler = (shortcut: KeyboardShortcut) => boolean;

export type ShortcutRegistry = ReadonlyMap<string, KeyboardShortcut>;
