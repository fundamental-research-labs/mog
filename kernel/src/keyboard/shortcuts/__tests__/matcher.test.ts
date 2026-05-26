/**
 * ShortcutMatcher Tests
 *
 * Comprehensive tests for the ShortcutMatcher class covering:
 * - O(1) lookup by physical key code
 * - Exact modifier matching
 * - Context matching with hierarchy
 * - Platform-specific binding resolution
 * - Priority-based conflict resolution
 * - IME composition blocking
 * - Key repeat handling
 * - rebuild() for customization
 * - getShortcutsForContext() for UI display
 * - wouldConflict() for conflict detection
 */

// Jest test file - no explicit imports needed for describe/it/expect/beforeEach
import {
  ShortcutMatcher,
  type KeyboardInput,
  type KeyboardShortcut,
  type ModifierState,
  type PhysicalKeyBinding,
  type Platform,
  type ShortcutContext,
} from '../matcher';

// Helper to create a KeyboardInput for testing
function createInput(
  physicalKey: string,
  modifiers: Partial<ModifierState> = {},
  options: {
    isComposing?: boolean;
    isRepeat?: boolean;
    platform?: Platform;
    character?: string;
  } = {},
): KeyboardInput {
  const defaultModifiers: ModifierState = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

  // For letter keys (KeyA-KeyZ), extract the character (a-z).
  // For other keys, use the physicalKey as-is.
  const defaultCharacter = /^Key[A-Z]$/.test(physicalKey)
    ? physicalKey.slice(3).toLowerCase()
    : physicalKey;

  return {
    physicalKey: physicalKey as KeyboardInput['physicalKey'],
    character: options.character ?? defaultCharacter,
    modifiers: { ...defaultModifiers, ...modifiers },
    isComposing: options.isComposing ?? false,
    isRepeat: options.isRepeat ?? false,
    platform: options.platform ?? 'windows',
    timestamp: Date.now(),
    originalEvent: {} as KeyboardEvent,
  };
}

/**
 * Map shortcut IDs to contextually appropriate action types.
 * Each test shortcut should dispatch a semantically correct action
 * rather than a universal stub.
 */
const ACTION_FOR_ID: Record<string, string> = {
  copy: 'COPY',
  'copy-selection': 'COPY',
  paste: 'PASTE',
  bold: 'TOGGLE_BOLD',
  insert: 'INSERT_ROW_ABOVE',
  edit: 'EDIT_CELL',
  rename: 'EDIT_CELL',
  'ctrl-a': 'SELECT_ALL',
  'shift-a': 'EXTEND_SELECTION_DOWN',
  'alt-a': 'SELECT_ALL',
  'meta-a': 'SELECT_ALL',
  'grid-only': 'MOVE_UP',
  save: 'SAVE',
  undo: 'UNDO',
  escape: 'CANCEL_EDIT',
  'formula-help': 'EDIT_CELL',
  multi: 'MOVE_UP',
  'low-priority': 'COPY',
  'high-priority': 'COPY',
  critical: 'COPY',
  medium: 'COPY',
  high: 'COPY',
  low: 'COPY',
  action: 'SELECT_ALL',
  navigate: 'MOVE_DOWN',
  delete: 'DELETE_ROWS',
  backspace: 'DELETE_ROWS',
  old: 'MOVE_UP',
  new: 'MOVE_DOWN',
  test: 'MOVE_UP',
  a: 'SELECT_ALL',
  b: 'TOGGLE_BOLD',
  'grid-and-dialog': 'MOVE_UP',
  'editing-only': 'EDIT_CELL',
  'formula-only': 'EDIT_CELL',
  global: 'SAVE',
  enabled: 'MOVE_UP',
  disabled: 'MOVE_DOWN',
  'formula-insert': 'EDIT_CELL',
  enter: 'COMMIT_AND_MOVE_DOWN',
  'all-mods': 'SELECT_ALL',
};

// Helper to create a shortcut for testing
function createShortcut(
  id: string,
  code: string,
  modifiers: Array<'ctrl' | 'shift' | 'alt' | 'meta'>,
  contexts: ShortcutContext[],
  options: {
    priority?: 'critical' | 'high' | 'medium' | 'low';
    enabled?: boolean;
    allowRepeat?: boolean;
    macBinding?: PhysicalKeyBinding;
    matchBy?: 'key' | 'code';
    expectedCharacter?: string;
  } = {},
): KeyboardShortcut {
  // Infer matchBy: letter keys with command modifier → 'key', else → 'code'
  const isLetterKey = /^Key[A-Z]$/.test(code);
  const hasCommandMod =
    modifiers.includes('ctrl') || modifiers.includes('meta') || modifiers.includes('alt');
  const matchBy = options.matchBy ?? (isLetterKey && hasCommandMod ? 'key' : 'code');
  const expectedCharacter =
    options.expectedCharacter ??
    (matchBy === 'key' && isLetterKey ? code.slice(3).toLowerCase() : undefined);

  // Fall back to MOVE_UP only for dynamically generated perf-test shortcuts (shortcut-X-N pattern).
  // All named test shortcuts must have an explicit mapping.
  const action =
    ACTION_FOR_ID[id] ??
    (/^shortcut-[A-Z]-\d+$/.test(id)
      ? 'MOVE_UP'
      : (() => {
          throw new Error(`No action mapped for test shortcut id: '${id}'`);
        })());
  return {
    id,
    bindings: {
      default: {
        code: code as PhysicalKeyBinding['code'],
        modifiers,
      },
      macos: options.macBinding,
    },
    description: `Test shortcut ${id}`,
    action: action as KeyboardShortcut['action'],
    enabled: options.enabled ?? true,
    priority: options.priority ?? 'medium',
    category: 'editing',
    contexts,
    muscleMemory: 'common',
    matchBy,
    expectedCharacter,
    allowRepeat: options.allowRepeat,
  };
}

describe('ShortcutMatcher', () => {
  describe('O(1) lookup by physical key code', () => {
    it('should find shortcut by exact physical key code', () => {
      const shortcuts = [
        createShortcut('copy', 'KeyC', ['ctrl'], ['grid']),
        createShortcut('paste', 'KeyV', ['ctrl'], ['grid']),
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      const input = createInput('KeyC', { ctrl: true });
      const result = matcher.match(input, 'grid');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('copy');
    });

    it('should return null for unregistered key code', () => {
      const shortcuts = [createShortcut('copy', 'KeyC', ['ctrl'], ['grid'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      const input = createInput('KeyX', { ctrl: true });
      const result = matcher.match(input, 'grid');

      expect(result).toBeNull();
    });

    it('should handle multiple shortcuts on same key code', () => {
      const shortcuts = [
        createShortcut('copy', 'KeyC', ['ctrl'], ['grid']),
        createShortcut('copy-selection', 'KeyC', ['ctrl', 'shift'], ['grid']),
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // Ctrl+C should match 'copy'
      const input1 = createInput('KeyC', { ctrl: true });
      expect(matcher.match(input1, 'grid')?.id).toBe('copy');

      // Ctrl+Shift+C should match 'copy-selection'
      const input2 = createInput('KeyC', { ctrl: true, shift: true });
      expect(matcher.match(input2, 'grid')?.id).toBe('copy-selection');
    });
  });

  describe('Exact modifier matching', () => {
    it('should require exact modifier match - no extra modifiers', () => {
      const shortcuts = [createShortcut('bold', 'KeyB', ['ctrl'], ['grid'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // Ctrl+B should match
      expect(matcher.match(createInput('KeyB', { ctrl: true }), 'grid')?.id).toBe('bold');

      // Ctrl+Shift+B should NOT match (extra modifier)
      expect(matcher.match(createInput('KeyB', { ctrl: true, shift: true }), 'grid')).toBeNull();

      // Ctrl+Alt+B should NOT match (extra modifier)
      expect(matcher.match(createInput('KeyB', { ctrl: true, alt: true }), 'grid')).toBeNull();
    });

    it('should require exact modifier match - no missing modifiers', () => {
      const shortcuts = [createShortcut('insert', 'Equal', ['ctrl', 'shift'], ['grid'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // Ctrl+Shift+= should match
      expect(matcher.match(createInput('Equal', { ctrl: true, shift: true }), 'grid')?.id).toBe(
        'insert',
      );

      // Ctrl+= should NOT match (missing shift)
      expect(matcher.match(createInput('Equal', { ctrl: true }), 'grid')).toBeNull();

      // Shift+= should NOT match (missing ctrl)
      expect(matcher.match(createInput('Equal', { shift: true }), 'grid')).toBeNull();
    });

    it('should handle no modifiers correctly', () => {
      const shortcuts = [
        createShortcut('edit', 'F2', [], ['grid']),
        createShortcut('rename', 'F2', ['ctrl'], ['grid']),
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // F2 (no modifiers) should match 'edit'
      expect(matcher.match(createInput('F2', {}), 'grid')?.id).toBe('edit');

      // Ctrl+F2 should match 'rename'
      expect(matcher.match(createInput('F2', { ctrl: true }), 'grid')?.id).toBe('rename');
    });

    it('should distinguish between all four modifiers', () => {
      const shortcuts = [
        createShortcut('ctrl-a', 'KeyA', ['ctrl'], ['grid']),
        createShortcut('shift-a', 'KeyA', ['shift'], ['grid']),
        createShortcut('alt-a', 'KeyA', ['alt'], ['grid']),
        createShortcut('meta-a', 'KeyA', ['meta'], ['grid']),
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      expect(matcher.match(createInput('KeyA', { ctrl: true }), 'grid')?.id).toBe('ctrl-a');
      expect(matcher.match(createInput('KeyA', { shift: true }), 'grid')?.id).toBe('shift-a');
      expect(matcher.match(createInput('KeyA', { alt: true }), 'grid')?.id).toBe('alt-a');
      expect(matcher.match(createInput('KeyA', { meta: true }), 'grid')?.id).toBe('meta-a');
    });
  });

  describe('Context matching with hierarchy', () => {
    it('should match exact context', () => {
      const shortcuts = [createShortcut('grid-only', 'KeyG', ['ctrl'], ['grid'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      expect(matcher.match(createInput('KeyG', { ctrl: true }), 'grid')?.id).toBe('grid-only');
      expect(matcher.match(createInput('KeyG', { ctrl: true }), 'dialog')).toBeNull();
    });

    it('should match "any" context to all contexts', () => {
      const shortcuts = [createShortcut('save', 'KeyS', ['ctrl'], ['any'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      expect(matcher.match(createInput('KeyS', { ctrl: true }), 'grid')?.id).toBe('save');
      expect(matcher.match(createInput('KeyS', { ctrl: true }), 'editing')?.id).toBe('save');
      expect(matcher.match(createInput('KeyS', { ctrl: true }), 'dialog')?.id).toBe('save');
      expect(matcher.match(createInput('KeyS', { ctrl: true }), 'enterMode')?.id).toBe('save');
    });

    it('should match "global" context to all contexts', () => {
      const shortcuts = [createShortcut('undo', 'KeyZ', ['ctrl'], ['global'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      expect(matcher.match(createInput('KeyZ', { ctrl: true }), 'grid')?.id).toBe('undo');
      expect(matcher.match(createInput('KeyZ', { ctrl: true }), 'editing')?.id).toBe('undo');
      expect(matcher.match(createInput('KeyZ', { ctrl: true }), 'objectSelected')?.id).toBe('undo');
    });

    it('should match "editing" to all editing modes', () => {
      const shortcuts = [createShortcut('escape', 'Escape', [], ['editing'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // Should match all editing modes
      expect(matcher.match(createInput('Escape', {}), 'enterMode')?.id).toBe('escape');
      expect(matcher.match(createInput('Escape', {}), 'editMode')?.id).toBe('escape');
      expect(matcher.match(createInput('Escape', {}), 'formulaEnterMode')?.id).toBe('escape');
      expect(matcher.match(createInput('Escape', {}), 'formulaEditMode')?.id).toBe('escape');

      // Should NOT match grid or other contexts
      expect(matcher.match(createInput('Escape', {}), 'grid')).toBeNull();
      expect(matcher.match(createInput('Escape', {}), 'dialog')).toBeNull();
    });

    it('should match "formulaEditing" to formula editing modes', () => {
      const shortcuts = [createShortcut('formula-help', 'F1', [], ['formulaEditing'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // Should match formula editing modes
      expect(matcher.match(createInput('F1', {}), 'formulaEnterMode')?.id).toBe('formula-help');
      expect(matcher.match(createInput('F1', {}), 'formulaEditMode')?.id).toBe('formula-help');

      // Should NOT match regular editing modes
      expect(matcher.match(createInput('F1', {}), 'enterMode')).toBeNull();
      expect(matcher.match(createInput('F1', {}), 'editMode')).toBeNull();
      expect(matcher.match(createInput('F1', {}), 'grid')).toBeNull();
    });

    it('should handle multiple contexts', () => {
      const shortcuts = [createShortcut('multi', 'KeyM', ['ctrl'], ['grid', 'dialog'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      expect(matcher.match(createInput('KeyM', { ctrl: true }), 'grid')?.id).toBe('multi');
      expect(matcher.match(createInput('KeyM', { ctrl: true }), 'dialog')?.id).toBe('multi');
      expect(matcher.match(createInput('KeyM', { ctrl: true }), 'editing')).toBeNull();
    });
  });

  describe('Platform-specific binding resolution', () => {
    it('should use default binding on Windows', () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: 'copy',
          bindings: {
            default: { code: 'KeyC', modifiers: ['ctrl'] },
            macos: { code: 'KeyC', modifiers: ['meta'] },
          },
          description: 'Copy',
          action: 'COPY',
          enabled: true,
          priority: 'high',
          category: 'clipboard',
          contexts: ['grid'],
          muscleMemory: 'essential',
          matchBy: 'key',
          expectedCharacter: 'c',
        },
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // Ctrl+C should work on Windows
      expect(matcher.match(createInput('KeyC', { ctrl: true }), 'grid')?.id).toBe('copy');

      // Cmd+C should NOT work on Windows
      expect(matcher.match(createInput('KeyC', { meta: true }), 'grid')).toBeNull();
      expect(matcher.matchWithReason(createInput('KeyC', { meta: true }), 'grid')).toEqual({
        shortcut: null,
        hadCandidates: false,
        blockedByRepeat: false,
      });
    });

    it('should use mac binding on Mac', () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: 'copy',
          bindings: {
            default: { code: 'KeyC', modifiers: ['ctrl'] },
            macos: { code: 'KeyC', modifiers: ['meta'] },
          },
          description: 'Copy',
          action: 'COPY',
          enabled: true,
          priority: 'high',
          category: 'clipboard',
          contexts: ['grid'],
          muscleMemory: 'essential',
          matchBy: 'key',
          expectedCharacter: 'c',
        },
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'macos');

      // Cmd+C should work on Mac
      expect(
        matcher.match(createInput('KeyC', { meta: true }, { platform: 'macos' }), 'grid')?.id,
      ).toBe('copy');

      // Ctrl+C should NOT work on Mac
      expect(
        matcher.match(createInput('KeyC', { ctrl: true }, { platform: 'macos' }), 'grid'),
      ).toBeNull();
    });

    it('should auto-convert Ctrl to Meta on Mac when no mac binding specified', () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: 'save',
          bindings: {
            default: { code: 'KeyS', modifiers: ['ctrl'] },
            // No mac-specific binding — resolveBinding auto-converts Ctrl→Meta
          },
          description: 'Save',
          action: 'SAVE',
          enabled: true,
          priority: 'high',
          category: 'file',
          contexts: ['any'],
          muscleMemory: 'essential',
          matchBy: 'key',
          expectedCharacter: 's',
        },
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'macos');

      // On Mac with no explicit mac binding, Ctrl is auto-converted to Meta (Cmd).
      // So Cmd+S should match, NOT Ctrl+S.
      expect(
        matcher.match(createInput('KeyS', { meta: true }, { platform: 'macos' }), 'grid')?.id,
      ).toBe('save');

      // Ctrl+S should NOT match on Mac (Ctrl was converted to Meta)
      expect(
        matcher.match(createInput('KeyS', { ctrl: true }, { platform: 'macos' }), 'grid'),
      ).toBeNull();
    });

    it('should handle different physical keys per platform', () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: 'insert',
          bindings: {
            default: { code: 'Equal', modifiers: ['ctrl', 'shift'] },
            macos: { code: 'NumpadAdd', modifiers: ['meta'] },
          },
          description: 'Insert',
          action: 'INSERT_ROW_ABOVE',
          enabled: true,
          priority: 'high',
          category: 'editing',
          contexts: ['grid'],
          muscleMemory: 'common',
          matchBy: 'code',
        },
      ];

      // Windows: Ctrl+Shift+=
      const winMatcher = new ShortcutMatcher(shortcuts, 'windows');
      expect(winMatcher.match(createInput('Equal', { ctrl: true, shift: true }), 'grid')?.id).toBe(
        'insert',
      );

      // Mac: Cmd+NumpadAdd
      const macMatcher = new ShortcutMatcher(shortcuts, 'macos');
      expect(
        macMatcher.match(createInput('NumpadAdd', { meta: true }, { platform: 'macos' }), 'grid')
          ?.id,
      ).toBe('insert');
    });
  });

  describe('Priority-based conflict resolution', () => {
    it('should return highest priority shortcut when multiple match', () => {
      // Both shortcuts on same key, same context, same modifiers
      // Only priority differs - this shouldn't normally happen in a well-designed system
      // but we test the behavior anyway
      const shortcuts = [
        createShortcut('low-priority', 'KeyC', ['ctrl'], ['grid'], { priority: 'low' }),
        createShortcut('high-priority', 'KeyC', ['ctrl'], ['grid'], { priority: 'high' }),
        createShortcut('critical', 'KeyC', ['ctrl'], ['grid'], { priority: 'critical' }),
        createShortcut('medium', 'KeyC', ['ctrl'], ['grid'], { priority: 'medium' }),
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      const result = matcher.match(createInput('KeyC', { ctrl: true }), 'grid');
      expect(result?.id).toBe('critical');
    });

    it('should respect priority order: critical > high > medium > low', () => {
      // Test each priority level against lower ones
      const shortcutsCriticalVsHigh = [
        createShortcut('critical', 'KeyA', ['ctrl'], ['grid'], { priority: 'critical' }),
        createShortcut('high', 'KeyA', ['ctrl'], ['grid'], { priority: 'high' }),
      ];
      expect(
        new ShortcutMatcher(shortcutsCriticalVsHigh, 'windows').match(
          createInput('KeyA', { ctrl: true }),
          'grid',
        )?.id,
      ).toBe('critical');

      const shortcutsHighVsMedium = [
        createShortcut('high', 'KeyA', ['ctrl'], ['grid'], { priority: 'high' }),
        createShortcut('medium', 'KeyA', ['ctrl'], ['grid'], { priority: 'medium' }),
      ];
      expect(
        new ShortcutMatcher(shortcutsHighVsMedium, 'windows').match(
          createInput('KeyA', { ctrl: true }),
          'grid',
        )?.id,
      ).toBe('high');

      const shortcutsMediumVsLow = [
        createShortcut('medium', 'KeyA', ['ctrl'], ['grid'], { priority: 'medium' }),
        createShortcut('low', 'KeyA', ['ctrl'], ['grid'], { priority: 'low' }),
      ];
      expect(
        new ShortcutMatcher(shortcutsMediumVsLow, 'windows').match(
          createInput('KeyA', { ctrl: true }),
          'grid',
        )?.id,
      ).toBe('medium');
    });
  });

  describe('IME composition blocking', () => {
    it('should return null when isComposing is true', () => {
      const shortcuts = [createShortcut('copy', 'KeyC', ['ctrl'], ['any'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // Normal input should match
      const normalInput = createInput('KeyC', { ctrl: true });
      expect(matcher.match(normalInput, 'grid')?.id).toBe('copy');

      // Composing input should NOT match
      const composingInput = createInput('KeyC', { ctrl: true }, { isComposing: true });
      expect(matcher.match(composingInput, 'grid')).toBeNull();
    });

    it('should block all shortcuts during IME composition', () => {
      const shortcuts = [
        createShortcut('copy', 'KeyC', ['ctrl'], ['any']),
        createShortcut('enter', 'Enter', [], ['editing']),
        createShortcut('escape', 'Escape', [], ['any']),
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // All should be blocked during composition
      expect(
        matcher.match(createInput('KeyC', { ctrl: true }, { isComposing: true }), 'grid'),
      ).toBeNull();
      expect(matcher.match(createInput('Enter', {}, { isComposing: true }), 'editing')).toBeNull();
      expect(matcher.match(createInput('Escape', {}, { isComposing: true }), 'grid')).toBeNull();
    });
  });

  describe('Key repeat handling', () => {
    it('should block repeating keys by default', () => {
      const shortcuts = [createShortcut('action', 'KeyA', ['ctrl'], ['grid'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // First press should work
      expect(
        matcher.match(createInput('KeyA', { ctrl: true }, { isRepeat: false }), 'grid')?.id,
      ).toBe('action');

      // Repeat should be blocked (allowRepeat defaults to false/undefined)
      expect(
        matcher.match(createInput('KeyA', { ctrl: true }, { isRepeat: true }), 'grid'),
      ).toBeNull();
    });

    it('should allow repeating keys when allowRepeat is true', () => {
      const shortcuts = [
        createShortcut('navigate', 'ArrowDown', [], ['grid'], { allowRepeat: true }),
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // First press should work
      expect(matcher.match(createInput('ArrowDown', {}, { isRepeat: false }), 'grid')?.id).toBe(
        'navigate',
      );

      // Repeat should also work
      expect(matcher.match(createInput('ArrowDown', {}, { isRepeat: true }), 'grid')?.id).toBe(
        'navigate',
      );
    });

    it('should respect allowRepeat per shortcut', () => {
      const shortcuts = [
        createShortcut('delete', 'Delete', [], ['grid'], { allowRepeat: false }),
        createShortcut('backspace', 'Backspace', [], ['grid'], { allowRepeat: true }),
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // Delete blocks repeat
      expect(matcher.match(createInput('Delete', {}, { isRepeat: true }), 'grid')).toBeNull();

      // Backspace allows repeat
      expect(matcher.match(createInput('Backspace', {}, { isRepeat: true }), 'grid')?.id).toBe(
        'backspace',
      );
    });
  });

  describe('rebuild()', () => {
    it('should replace shortcuts with new set', () => {
      const initialShortcuts = [createShortcut('old', 'KeyO', ['ctrl'], ['grid'])];
      const matcher = new ShortcutMatcher(initialShortcuts, 'windows');

      expect(matcher.match(createInput('KeyO', { ctrl: true }), 'grid')?.id).toBe('old');
      expect(matcher.match(createInput('KeyN', { ctrl: true }), 'grid')).toBeNull();

      // Rebuild with new shortcuts
      const newShortcuts = [createShortcut('new', 'KeyN', ['ctrl'], ['grid'])];
      matcher.rebuild(newShortcuts);

      expect(matcher.match(createInput('KeyO', { ctrl: true }), 'grid')).toBeNull();
      expect(matcher.match(createInput('KeyN', { ctrl: true }), 'grid')?.id).toBe('new');
    });

    it('should handle empty shortcut array', () => {
      const shortcuts = [createShortcut('test', 'KeyT', ['ctrl'], ['grid'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      matcher.rebuild([]);

      expect(matcher.match(createInput('KeyT', { ctrl: true }), 'grid')).toBeNull();
      expect(matcher.getAllShortcuts()).toHaveLength(0);
    });

    it('should update getAllShortcuts() result', () => {
      const matcher = new ShortcutMatcher([], 'windows');
      expect(matcher.getAllShortcuts()).toHaveLength(0);

      matcher.rebuild([
        createShortcut('a', 'KeyA', ['ctrl'], ['grid']),
        createShortcut('b', 'KeyB', ['ctrl'], ['grid']),
      ]);

      expect(matcher.getAllShortcuts()).toHaveLength(2);
    });
  });

  describe('getShortcutsForContext()', () => {
    let matcher: ShortcutMatcher;

    beforeEach(() => {
      const shortcuts = [
        createShortcut('grid-only', 'KeyG', ['ctrl'], ['grid'], { priority: 'high' }),
        createShortcut('editing-only', 'KeyE', ['ctrl'], ['editing'], { priority: 'medium' }),
        createShortcut('formula-only', 'KeyF', ['ctrl'], ['formulaEditing'], { priority: 'low' }),
        createShortcut('global', 'KeyS', ['ctrl'], ['global'], { priority: 'critical' }),
        createShortcut('grid-and-dialog', 'KeyD', ['ctrl'], ['grid', 'dialog']),
      ];
      matcher = new ShortcutMatcher(shortcuts, 'windows');
    });

    it('should return shortcuts for exact context match', () => {
      const gridShortcuts = matcher.getShortcutsForContext('grid');
      const ids = gridShortcuts.map((s) => s.id);

      expect(ids).toContain('grid-only');
      expect(ids).toContain('global');
      expect(ids).toContain('grid-and-dialog');
      expect(ids).not.toContain('editing-only');
      expect(ids).not.toContain('formula-only');
    });

    it('should return editing shortcuts for nested editing contexts', () => {
      const enterModeShortcuts = matcher.getShortcutsForContext('enterMode');
      const ids = enterModeShortcuts.map((s) => s.id);

      expect(ids).toContain('editing-only');
      expect(ids).toContain('global');
      expect(ids).not.toContain('grid-only');
    });

    it('should return formula shortcuts for formula editing contexts', () => {
      const formulaEditShortcuts = matcher.getShortcutsForContext('formulaEditMode');
      const ids = formulaEditShortcuts.map((s) => s.id);

      expect(ids).toContain('formula-only');
      expect(ids).toContain('editing-only');
      expect(ids).toContain('global');
    });

    it('should sort by priority (highest first)', () => {
      const shortcuts = matcher.getShortcutsForContext('grid');

      // Critical should come first
      expect(shortcuts[0].id).toBe('global');
      expect(shortcuts[0].priority).toBe('critical');

      // High should come second
      const highPriorityIndex = shortcuts.findIndex((s) => s.id === 'grid-only');
      expect(shortcuts[highPriorityIndex].priority).toBe('high');
    });

    it('should not include disabled shortcuts', () => {
      const shortcuts = [
        createShortcut('enabled', 'KeyE', ['ctrl'], ['grid'], { enabled: true }),
        createShortcut('disabled', 'KeyD', ['ctrl'], ['grid'], { enabled: false }),
      ];
      const testMatcher = new ShortcutMatcher(shortcuts, 'windows');

      const result = testMatcher.getShortcutsForContext('grid');
      expect(result.map((s) => s.id)).toContain('enabled');
      expect(result.map((s) => s.id)).not.toContain('disabled');
    });

    it('should not return duplicates', () => {
      const shortcuts = matcher.getShortcutsForContext('grid');
      const ids = shortcuts.map((s) => s.id);
      const uniqueIds = Array.from(new Set(ids));

      expect(ids.length).toBe(uniqueIds.length);
    });
  });

  describe('wouldConflict()', () => {
    let matcher: ShortcutMatcher;

    beforeEach(() => {
      const shortcuts = [
        createShortcut('copy', 'KeyC', ['ctrl'], ['grid']),
        createShortcut('paste', 'KeyV', ['ctrl'], ['grid']),
        createShortcut('save', 'KeyS', ['ctrl'], ['any']),
        createShortcut('formula-insert', 'KeyF', ['ctrl'], ['formulaEditing']),
      ];
      matcher = new ShortcutMatcher(shortcuts, 'windows');
    });

    it('should detect direct conflict', () => {
      const newBinding: PhysicalKeyBinding = { code: 'KeyC', modifiers: ['ctrl'] };
      const conflict = matcher.wouldConflict(newBinding, 'grid');

      expect(conflict).not.toBeNull();
      expect(conflict?.id).toBe('copy');
    });

    it('should return null when no conflict', () => {
      const newBinding: PhysicalKeyBinding = { code: 'KeyX', modifiers: ['ctrl'] };
      const conflict = matcher.wouldConflict(newBinding, 'grid');

      expect(conflict).toBeNull();
    });

    it('should not conflict with different modifiers', () => {
      const newBinding: PhysicalKeyBinding = { code: 'KeyC', modifiers: ['ctrl', 'shift'] };
      const conflict = matcher.wouldConflict(newBinding, 'grid');

      expect(conflict).toBeNull();
    });

    it('should not conflict in non-overlapping contexts', () => {
      // KeyC+Ctrl exists in 'grid', but we're checking 'dialog'
      const newBinding: PhysicalKeyBinding = { code: 'KeyC', modifiers: ['ctrl'] };
      const conflict = matcher.wouldConflict(newBinding, 'dialog');

      expect(conflict).toBeNull();
    });

    it('should detect conflict with global shortcut', () => {
      // 'save' is in 'any' context, should conflict everywhere
      const newBinding: PhysicalKeyBinding = { code: 'KeyS', modifiers: ['ctrl'] };

      expect(matcher.wouldConflict(newBinding, 'grid')?.id).toBe('save');
      expect(matcher.wouldConflict(newBinding, 'editing')?.id).toBe('save');
      expect(matcher.wouldConflict(newBinding, 'dialog')?.id).toBe('save');
    });

    it('should exclude specified shortcut id', () => {
      // When editing 'copy', it shouldn't conflict with itself
      const newBinding: PhysicalKeyBinding = { code: 'KeyC', modifiers: ['ctrl'] };

      const withExclude = matcher.wouldConflict(newBinding, 'grid', 'copy');
      const withoutExclude = matcher.wouldConflict(newBinding, 'grid');

      expect(withExclude).toBeNull();
      expect(withoutExclude?.id).toBe('copy');
    });

    it('should detect conflict in context hierarchy', () => {
      // 'formula-insert' is in 'formulaEditing'
      // Should conflict with 'formulaEnterMode' and 'formulaEditMode'
      const newBinding: PhysicalKeyBinding = { code: 'KeyF', modifiers: ['ctrl'] };

      expect(matcher.wouldConflict(newBinding, 'formulaEnterMode')?.id).toBe('formula-insert');
      expect(matcher.wouldConflict(newBinding, 'formulaEditMode')?.id).toBe('formula-insert');
      expect(matcher.wouldConflict(newBinding, 'enterMode')).toBeNull();
    });
  });

  describe('Disabled shortcuts', () => {
    it('should not match disabled shortcuts', () => {
      const shortcuts = [
        createShortcut('enabled', 'KeyE', ['ctrl'], ['grid'], { enabled: true }),
        createShortcut('disabled', 'KeyD', ['ctrl'], ['grid'], { enabled: false }),
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      expect(matcher.match(createInput('KeyE', { ctrl: true }), 'grid')?.id).toBe('enabled');
      expect(matcher.match(createInput('KeyD', { ctrl: true }), 'grid')).toBeNull();
    });

    it('should not index disabled shortcuts', () => {
      const shortcuts = [
        createShortcut('disabled', 'KeyD', ['ctrl'], ['grid'], { enabled: false }),
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // getShortcutsForContext should not return disabled shortcuts
      const gridShortcuts = matcher.getShortcutsForContext('grid');
      expect(gridShortcuts.find((s) => s.id === 'disabled')).toBeUndefined();
    });
  });

  describe('getShortcutsByCategory()', () => {
    it('should filter shortcuts by category', () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: 'copy',
          bindings: { default: { code: 'KeyC', modifiers: ['ctrl'] } },
          description: 'Copy',
          action: 'COPY',
          enabled: true,
          priority: 'high',
          category: 'clipboard',
          contexts: ['grid'],
          muscleMemory: 'essential',
          matchBy: 'key',
          expectedCharacter: 'c',
        },
        {
          id: 'bold',
          bindings: { default: { code: 'KeyB', modifiers: ['ctrl'] } },
          description: 'Bold',
          action: 'TOGGLE_BOLD',
          enabled: true,
          priority: 'medium',
          category: 'formatting',
          contexts: ['grid'],
          muscleMemory: 'essential',
          matchBy: 'key',
          expectedCharacter: 'b',
        },
        {
          id: 'disabled-clipboard',
          bindings: { default: { code: 'KeyX', modifiers: ['ctrl'] } },
          description: 'Cut',
          action: 'CUT',
          enabled: false,
          priority: 'high',
          category: 'clipboard',
          contexts: ['grid'],
          muscleMemory: 'essential',
          matchBy: 'key',
          expectedCharacter: 'x',
        },
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      const clipboardShortcuts = matcher.getShortcutsByCategory('clipboard');
      expect(clipboardShortcuts).toHaveLength(1);
      expect(clipboardShortcuts[0].id).toBe('copy');

      const formattingShortcuts = matcher.getShortcutsByCategory('formatting');
      expect(formattingShortcuts).toHaveLength(1);
      expect(formattingShortcuts[0].id).toBe('bold');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty shortcuts array', () => {
      const matcher = new ShortcutMatcher([], 'windows');

      expect(matcher.match(createInput('KeyA', { ctrl: true }), 'grid')).toBeNull();
      expect(matcher.getShortcutsForContext('grid')).toHaveLength(0);
    });

    it('should handle unknown physical key code gracefully', () => {
      const shortcuts = [createShortcut('test', 'KeyA', ['ctrl'], ['grid'])];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // Unknown key code should return null, not throw
      const input = createInput('UnknownKey' as any, { ctrl: true });
      expect(matcher.match(input, 'grid')).toBeNull();
    });

    it('should preserve shortcut references', () => {
      const original = createShortcut('test', 'KeyT', ['ctrl'], ['grid']);
      const matcher = new ShortcutMatcher([original], 'windows');

      const matched = matcher.match(createInput('KeyT', { ctrl: true }), 'grid');
      expect(matched).toBe(original);
    });

    it('should handle shortcut with all modifiers', () => {
      const shortcuts = [
        createShortcut('all-mods', 'KeyA', ['ctrl', 'shift', 'alt', 'meta'], ['grid']),
      ];
      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // All modifiers required
      expect(
        matcher.match(
          createInput('KeyA', { ctrl: true, shift: true, alt: true, meta: true }),
          'grid',
        )?.id,
      ).toBe('all-mods');

      // Missing any modifier should fail
      expect(
        matcher.match(createInput('KeyA', { ctrl: true, shift: true, alt: true }), 'grid'),
      ).toBeNull();
    });
  });

  describe('Performance characteristics', () => {
    it('should handle large number of shortcuts efficiently', () => {
      // Create 300+ shortcuts
      const shortcuts: KeyboardShortcut[] = [];
      const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      const modifierCombos: Array<Array<'ctrl' | 'shift' | 'alt'>> = [
        ['ctrl'],
        ['ctrl', 'shift'],
        ['ctrl', 'alt'],
        ['alt'],
        ['alt', 'shift'],
      ];

      for (const key of keys) {
        modifierCombos.forEach((mods, index) => {
          shortcuts.push(
            createShortcut(`shortcut-${key}-${index}`, `Key${key}` as any, mods, ['grid']),
          );
        });
      }

      // Should have at least 130 shortcuts (26 keys * 5 combos)
      expect(shortcuts.length).toBeGreaterThanOrEqual(130);

      const matcher = new ShortcutMatcher(shortcuts, 'windows');

      // Measure match time
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        matcher.match(createInput('KeyZ', { ctrl: true, shift: true }), 'grid');
      }
      const elapsed = performance.now() - start;

      // Average should be well under 1ms per match
      const avgTime = elapsed / 1000;
      expect(avgTime).toBeLessThan(1);
    });
  });
});
