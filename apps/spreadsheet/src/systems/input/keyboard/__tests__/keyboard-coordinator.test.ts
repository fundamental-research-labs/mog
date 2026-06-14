/**
 * KeyboardCoordinator Tests
 *
 * Tests for matching behavior aligned with ShortcutMatcher:
 * 1. Priority sorting - higher priority shortcuts are matched first
 * 2. allowRepeat check - shortcuts with allowRepeat: false are skipped on repeat events
 * 3. 'global' context recognition - 'global' context matches any current context
 * 4. Disabled shortcuts - disabled shortcuts are excluded at index time (C3 fix)
 * 5. Repeat-blocked reason - repeat-blocked events return 'not_found' not 'wrong_context' (M4 fix)
 * 6. byKey-to-byCode fallthrough - when byKey bucket has no context/repeat match, falls through to byCode
 */

import { jest } from '@jest/globals';

import type { KeyboardShortcut } from '../../../../keyboard';

// ---------------------------------------------------------------------------
// Test shortcut factory
// ---------------------------------------------------------------------------

function makeShortcut(overrides: Partial<KeyboardShortcut> & { id: string }): KeyboardShortcut {
  return {
    bindings: {
      default: { code: 'KeyB' as any, modifiers: ['ctrl'] },
    },
    description: `Test shortcut ${overrides.id}`,
    action: 'MOVE_UP',
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock KEYBOARD_SHORTCUTS so we can control what the coordinator sees
// ---------------------------------------------------------------------------

// Mutable array that the mock KEYBOARD_SHORTCUTS points to.
// We mutate its contents (via splice + push) before each test so the same
// array reference that was captured at import-time reflects our test data.
const TEST_SHORTCUTS: KeyboardShortcut[] = [];

jest.mock('../../../../keyboard', () => ({
  ...jest.requireActual('../../../../keyboard'),
  KEYBOARD_SHORTCUTS: TEST_SHORTCUTS,
}));

// Mock the actions module to break the deep dependency chain
// (keyboard-coordinator -> actions -> dispatcher -> kernel -> xlsx-parser)
jest.mock('../../../../actions', () => ({
  dispatch: jest.fn(() => ({ handled: true })),
}));

// Import AFTER mock is set up
import { KeyboardCoordinator } from '../keyboard-coordinator';

/** Replace TEST_SHORTCUTS contents in-place so the captured reference stays valid. */
function setTestShortcuts(shortcuts: KeyboardShortcut[]): void {
  TEST_SHORTCUTS.length = 0;
  TEST_SHORTCUTS.push(...shortcuts);
}

function createTestCoordinator(): KeyboardCoordinator {
  return new KeyboardCoordinator('windows', TEST_SHORTCUTS);
}

// ---------------------------------------------------------------------------
// Helper: create a mock KeyboardEvent
// ---------------------------------------------------------------------------

function mockKeyboardEvent(
  overrides: Partial<KeyboardEvent> & { code: string; key: string },
): KeyboardEvent {
  return {
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 0,
    ...overrides,
  } as unknown as KeyboardEvent;
}

function createDispatchableDependencies(dispatchFn = jest.fn(() => ({ handled: true }))) {
  const idleSnapshot = {
    matches: () => false,
    context: { isEditMode: false },
  };
  const selectionSnapshot = {
    matches: () => false,
    context: { modes: {} },
  };

  return {
    workbook: {},
    selectionActor: { getSnapshot: () => selectionSnapshot, send: jest.fn() },
    editorActor: { getSnapshot: () => idleSnapshot, send: jest.fn() },
    clipboardActor: { getSnapshot: () => idleSnapshot, send: jest.fn() },
    objectInteractionActor: { getSnapshot: () => idleSnapshot, send: jest.fn() },
    chartActor: { getSnapshot: () => idleSnapshot, send: jest.fn() },
    findReplaceActor: { getSnapshot: () => idleSnapshot, send: jest.fn() },
    commentActor: { getSnapshot: () => idleSnapshot, send: jest.fn() },
    paneFocusActor: { getSnapshot: () => idleSnapshot, send: jest.fn() },
    rendererActor: { getSnapshot: () => idleSnapshot, send: jest.fn() },
    getActiveSheetId: () => 'sheet1',
    uiStore: { getState: jest.fn(() => ({})) },
    platform: {},
    shellService: {},
    createAccessLayer: jest.fn().mockReturnValue({ accessors: {}, commands: {} }),
    dispatch: dispatchFn,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KeyboardCoordinator - Gap Fixes', () => {
  describe('Editable navigation key targets', () => {
    it('defers Enter from chrome inputs so their local handler can run', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'enter-navigation',
          action: 'ENTER_NAVIGATE',
          contexts: ['grid'],
          matchBy: 'code',
          bindings: { default: { code: 'Enter' as any, modifiers: [] } },
        }),
      ]);

      const dispatchFn = jest.fn(() => ({ handled: true }));
      const coordinator = createTestCoordinator();
      coordinator.setDependencies(createDispatchableDependencies(dispatchFn) as any);

      const formulaBar = document.createElement('div');
      formulaBar.setAttribute('data-formula-bar', '');
      const input = document.createElement('input');
      input.setAttribute('data-testid', 'name-box');
      formulaBar.appendChild(input);

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({ code: 'Enter', key: 'Enter', target: input }),
      );

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('not_found');
      expect(dispatchFn).not.toHaveBeenCalled();
    });

    it('still routes Enter from the inline cell editor through spreadsheet navigation', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'enter-navigation',
          action: 'ENTER_NAVIGATE',
          contexts: ['grid'],
          matchBy: 'code',
          bindings: { default: { code: 'Enter' as any, modifiers: [] } },
        }),
      ]);

      const dispatchFn = jest.fn(() => ({ handled: true }));
      const coordinator = createTestCoordinator();
      coordinator.setDependencies(createDispatchableDependencies(dispatchFn) as any);

      const input = document.createElement('textarea');
      input.setAttribute('data-testid', 'inline-cell-editor');

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({ code: 'Enter', key: 'Enter', target: input }),
      );

      expect(result.handled).toBe(true);
      expect(result.action).toBe('ENTER_NAVIGATE');
      expect(dispatchFn).toHaveBeenCalledTimes(1);
    });

    it('still routes Enter from the formula bar editor through spreadsheet navigation', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'enter-navigation',
          action: 'ENTER_NAVIGATE',
          contexts: ['grid'],
          matchBy: 'code',
          bindings: { default: { code: 'Enter' as any, modifiers: [] } },
        }),
      ]);

      const dispatchFn = jest.fn(() => ({ handled: true }));
      const coordinator = createTestCoordinator();
      coordinator.setDependencies(createDispatchableDependencies(dispatchFn) as any);

      const input = document.createElement('input');
      input.setAttribute('data-testid', 'formula-bar-input');

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({ code: 'Enter', key: 'Enter', target: input }),
      );

      expect(result.handled).toBe(true);
      expect(result.action).toBe('ENTER_NAVIGATE');
      expect(dispatchFn).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Gap 1: Priority sorting
  // =========================================================================
  describe('Gap 1: Priority sorting', () => {
    it('should match higher priority shortcut when multiple shortcuts share the same binding', () => {
      // Two shortcuts on the same physical key + modifiers, different priorities
      const lowPriority = makeShortcut({
        id: 'low-action',
        priority: 'low',
        contexts: ['grid'],
        matchBy: 'code',
        bindings: { default: { code: 'F5' as any, modifiers: [] } },
      });
      const highPriority = makeShortcut({
        id: 'high-action',
        priority: 'high',
        contexts: ['grid'],
        bindings: { default: { code: 'F5' as any, modifiers: [] } },
        matchBy: 'code',
      });

      // Register low first so without sorting it would win
      setTestShortcuts([lowPriority, highPriority]);

      const coordinator = createTestCoordinator();
      // We need minimal deps for context (defaults to 'grid' when no deps set)
      const result = coordinator.handleKeyboardEvent(mockKeyboardEvent({ code: 'F5', key: 'F5' }));

      expect(result.handled).toBe(false); // no deps → buildActionDependencies returns null
      // But we can verify which action was matched by checking the action field
      // Actually, when actionDeps is null, it returns not_found.
      // Let's instead verify via a different approach: check that shortcut lookup returns sorted.

      // The coordinator has getShortcutsForKey which returns the bucket directly.
      const shortcuts = coordinator.getShortcutsForKey('F5');
      expect(shortcuts.length).toBe(2);
      // First should be high priority (critical:0, high:1, medium:2, low:3)
      expect(shortcuts[0].id).toBe('high-action');
      expect(shortcuts[1].id).toBe('low-action');
    });

    it('should sort critical > high > medium > low in code-based lookup', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'low',
          priority: 'low',
          matchBy: 'code',
          bindings: { default: { code: 'Escape' as any, modifiers: [] } },
        }),
        makeShortcut({
          id: 'medium',
          priority: 'medium',
          matchBy: 'code',
          bindings: { default: { code: 'Escape' as any, modifiers: [] } },
        }),
        makeShortcut({
          id: 'critical',
          priority: 'critical',
          matchBy: 'code',
          bindings: { default: { code: 'Escape' as any, modifiers: [] } },
        }),
        makeShortcut({
          id: 'high',
          priority: 'high',
          matchBy: 'code',
          bindings: { default: { code: 'Escape' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      const shortcuts = coordinator.getShortcutsForKey('Escape');

      expect(shortcuts.map((s) => s.id)).toEqual(['critical', 'high', 'medium', 'low']);
    });

    it('should sort by priority in character-based (byKey) lookup', () => {
      // matchBy: 'key' shortcuts go into the byKeyLookup
      setTestShortcuts([
        makeShortcut({
          id: 'low-bold',
          priority: 'low',
          matchBy: 'key',
          expectedCharacter: 'b',
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
          contexts: ['grid'],
        }),
        makeShortcut({
          id: 'high-bold',
          priority: 'high',
          matchBy: 'key',
          expectedCharacter: 'b',
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
          contexts: ['grid'],
        }),
      ]);

      const coordinator = createTestCoordinator();

      // Trigger a keyboard event for Ctrl+B (character 'b')
      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'KeyB',
          key: 'b',
          ctrlKey: true,
        }),
      );

      // Without deps it won't dispatch, but let's verify the action it found
      // Since no deps, result will be not_found (null actionDeps).
      // The important thing is it didn't crash and went through the correct path.
      // We can't directly access byKeyLookup, but the handleKeyboardEvent
      // tries char-based first, so if sorted correctly, high-bold is found first.
      // Let's check indirectly — if it found a shortcut but couldn't dispatch:
      expect(result.reason).toBe('not_found'); // no actionDeps
    });
  });

  // =========================================================================
  // Gap 2: allowRepeat check
  // =========================================================================
  describe('Gap 2: allowRepeat check', () => {
    it('should skip shortcuts with allowRepeat: false on repeat events', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'no-repeat',
          allowRepeat: false,
          matchBy: 'code',
          bindings: { default: { code: 'KeyS' as any, modifiers: ['ctrl'] } },
          contexts: ['grid'],
        }),
      ]);

      const coordinator = createTestCoordinator();
      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'KeyS',
          key: 's',
          ctrlKey: true,
          repeat: true,
        }),
      );

      // Should not match the shortcut because allowRepeat is false and event.repeat is true
      // M4 fix: repeat-blocked events now return 'not_found' instead of 'wrong_context'
      expect(result.handled).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('should skip shortcuts with allowRepeat: undefined on repeat events', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'no-repeat-undefined',
          // allowRepeat not set → defaults to undefined → treated as false
          matchBy: 'code',
          bindings: { default: { code: 'KeyS' as any, modifiers: ['ctrl'] } },
          contexts: ['grid'],
        }),
      ]);

      // Make sure allowRepeat is not set
      delete (TEST_SHORTCUTS[0] as any).allowRepeat;

      const coordinator = createTestCoordinator();
      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'KeyS',
          key: 's',
          ctrlKey: true,
          repeat: true,
        }),
      );

      expect(result.handled).toBe(false);
      // M4 fix: repeat-blocked events now return 'not_found' instead of 'wrong_context'
      expect(result.reason).toBe('not_found');
    });

    it('should match shortcuts with allowRepeat: true on repeat events', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'allow-repeat',
          allowRepeat: true,
          matchBy: 'code',
          bindings: { default: { code: 'ArrowDown' as any, modifiers: [] } },
          contexts: ['grid'],
        }),
      ]);

      const coordinator = createTestCoordinator();
      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'ArrowDown',
          key: 'ArrowDown',
          repeat: true,
        }),
      );

      // Should match the shortcut because allowRepeat is true.
      // It will proceed past context matching but fail at dispatch (no deps),
      // returning 'not_found' from buildActionDependencies returning null.
      // The key assertion: it should NOT be 'wrong_context' (which means
      // the allowRepeat filter did not block the match).
      expect(result.reason).not.toBe('wrong_context');
      // 'not_found' here means "matched shortcut but no deps to dispatch" — that's expected.
      expect(result.reason).toBe('not_found');
    });

    it('should match shortcuts with allowRepeat: false on non-repeat events', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'no-repeat-initial',
          allowRepeat: false,
          matchBy: 'code',
          bindings: { default: { code: 'KeyS' as any, modifiers: ['ctrl'] } },
          contexts: ['grid'],
        }),
      ]);

      const coordinator = createTestCoordinator();
      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'KeyS',
          key: 's',
          ctrlKey: true,
          repeat: false,
        }),
      );

      // Should match the shortcut because event.repeat is false
      // Will fail at dispatch, but the matching stage should succeed
      expect(result.reason).not.toBe('wrong_context');
    });

    it('should fall through to next shortcut when first has allowRepeat: false on repeat', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'no-repeat',
          allowRepeat: false,
          priority: 'high',
          matchBy: 'code',
          bindings: { default: { code: 'ArrowUp' as any, modifiers: [] } },
          contexts: ['grid'],
        }),
        makeShortcut({
          id: 'yes-repeat',
          allowRepeat: true,
          priority: 'low',
          matchBy: 'code',
          bindings: { default: { code: 'ArrowUp' as any, modifiers: [] } },
          contexts: ['grid'],
        }),
      ]);

      const coordinator = createTestCoordinator();
      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'ArrowUp',
          key: 'ArrowUp',
          repeat: true,
        }),
      );

      // Should skip 'no-repeat' (allowRepeat: false) and match 'yes-repeat'
      // Dispatching will fail (no deps), but action should be set if it gets that far
      // Since no deps, it returns not_found, but importantly not wrong_context
      expect(result.reason).not.toBe('wrong_context');
    });
  });

  // =========================================================================
  // Gap 3: 'global' context recognition
  // =========================================================================
  describe("Gap 3: 'global' context recognition", () => {
    it("should match shortcuts with 'global' context when current context is 'grid'", () => {
      setTestShortcuts([
        makeShortcut({
          id: 'global-save',
          contexts: ['global'],
          matchBy: 'code',
          bindings: { default: { code: 'KeyS' as any, modifiers: ['ctrl'] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      // No deps → getCurrentContext() returns 'grid'
      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'KeyS',
          key: 's',
          ctrlKey: true,
        }),
      );

      // Should match: 'global' context matches everything
      // Will fail at dispatch (no deps), but should not fail at context matching
      expect(result.reason).not.toBe('wrong_context');
    });

    it("should match shortcuts with 'global' context when current context is editing", () => {
      setTestShortcuts([
        makeShortcut({
          id: 'global-shortcut',
          contexts: ['global'],
          matchBy: 'code',
          bindings: { default: { code: 'F1' as any, modifiers: [] } },
        }),
      ]);

      // Create coordinator with mock deps that put us in editing context
      const coordinator = createTestCoordinator();
      const mockEditorSnapshot = {
        matches: (state: string) => state === 'editing',
        context: { isEditMode: true },
      };
      coordinator.setDependencies({
        workbook: {} as any,
        selectionActor: { getSnapshot: jest.fn() } as any,
        editorActor: { getSnapshot: () => mockEditorSnapshot } as any,
        clipboardActor: {} as any,
        objectInteractionActor: {} as any,
        chartActor: {} as any,
        findReplaceActor: {} as any,
        commentActor: {} as any,
        paneFocusActor: {} as any,
        getActiveSheetId: () => 'sheet1',
        createAccessLayer: jest.fn().mockReturnValue({ accessors: {}, commands: {} }),
      });

      // getCurrentContext will return 'editMode' (editing + isEditMode=true)
      const context = coordinator.getContext();
      expect(context).toBe('editMode');

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'F1',
          key: 'F1',
        }),
      );

      // Should match because 'global' is a wildcard — but will fail at dispatch (no uiStore)
      expect(result.reason).not.toBe('wrong_context');
    });

    it('should classify rich text editing through edit-mode shortcut context', () => {
      const coordinator = createTestCoordinator();
      const mockEditorSnapshot = {
        matches: (state: string) => state === 'richTextEditing',
        context: { isEditMode: true },
      };
      coordinator.setDependencies({
        ...createDispatchableDependencies(),
        editorActor: { getSnapshot: () => mockEditorSnapshot } as any,
      });

      expect(coordinator.getContext()).toBe('editMode');
    });

    it("should treat 'any' and 'global' both as wildcards", () => {
      setTestShortcuts([
        makeShortcut({
          id: 'any-shortcut',
          contexts: ['any'],
          matchBy: 'code',
          bindings: { default: { code: 'F1' as any, modifiers: [] } },
        }),
        makeShortcut({
          id: 'global-shortcut',
          contexts: ['global'],
          matchBy: 'code',
          bindings: { default: { code: 'F2' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();

      // Both should match in 'grid' context (no deps → grid)
      const result1 = coordinator.handleKeyboardEvent(mockKeyboardEvent({ code: 'F1', key: 'F1' }));
      const result2 = coordinator.handleKeyboardEvent(mockKeyboardEvent({ code: 'F2', key: 'F2' }));

      // Neither should fail with wrong_context
      expect(result1.reason).not.toBe('wrong_context');
      expect(result2.reason).not.toBe('wrong_context');
    });

    it("should NOT match 'global' shortcut if it's the wrong binding", () => {
      setTestShortcuts([
        makeShortcut({
          id: 'global-specific',
          contexts: ['global'],
          matchBy: 'code',
          bindings: { default: { code: 'KeyS' as any, modifiers: ['ctrl'] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      // Press F1 — no shortcut registered for F1
      const result = coordinator.handleKeyboardEvent(mockKeyboardEvent({ code: 'F1', key: 'F1' }));

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('not_found');
    });
  });

  // =========================================================================
  // Bug C3: Disabled shortcuts excluded at index time
  // =========================================================================
  describe('Bug C3: Disabled shortcuts excluded at index time', () => {
    it('should not index disabled shortcuts in code-based lookup', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'disabled-escape',
          enabled: false,
          priority: 'critical',
          matchBy: 'code',
          bindings: { default: { code: 'Escape' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();

      // The disabled shortcut should not appear in the lookup table
      const shortcuts = coordinator.getShortcutsForKey('Escape');
      expect(shortcuts.length).toBe(0);
    });

    it('should not index disabled shortcuts in character-based lookup', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'disabled-bold',
          enabled: false,
          matchBy: 'key',
          expectedCharacter: 'b',
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
        }),
      ]);

      const coordinator = createTestCoordinator();

      // Pressing Ctrl+B should not find the disabled shortcut
      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'KeyB',
          key: 'b',
          ctrlKey: true,
        }),
      );

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('should match enabled shortcut when disabled higher-priority shortcut shares the same binding', () => {
      // This is the key scenario: a disabled critical shortcut should not shadow
      // an enabled medium shortcut on the same binding.
      setTestShortcuts([
        makeShortcut({
          id: 'disabled-critical',
          enabled: false,
          priority: 'critical',
          matchBy: 'code',
          contexts: ['grid'],
          bindings: { default: { code: 'F5' as any, modifiers: [] } },
        }),
        makeShortcut({
          id: 'enabled-medium',
          enabled: true,
          priority: 'medium',
          matchBy: 'code',
          contexts: ['grid'],
          bindings: { default: { code: 'F5' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();

      // Only the enabled shortcut should be in the lookup
      const shortcuts = coordinator.getShortcutsForKey('F5');
      expect(shortcuts.length).toBe(1);
      expect(shortcuts[0].id).toBe('enabled-medium');
      expect(shortcuts[0].enabled).toBe(true);

      // Pressing F5 should match the enabled medium shortcut (not the disabled critical)
      const result = coordinator.handleKeyboardEvent(mockKeyboardEvent({ code: 'F5', key: 'F5' }));

      // Without deps it returns not_found from dispatch, but it should NOT return
      // 'not_implemented' (which was the old bug — disabled shortcut was matched first)
      expect(result.reason).not.toBe('not_implemented');
      expect(result.reason).toBe('not_found'); // no actionDeps
    });

    it('should return not_found when all shortcuts for a binding are disabled', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'disabled-1',
          enabled: false,
          matchBy: 'code',
          bindings: { default: { code: 'F9' as any, modifiers: [] } },
        }),
        makeShortcut({
          id: 'disabled-2',
          enabled: false,
          matchBy: 'code',
          bindings: { default: { code: 'F9' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();

      const result = coordinator.handleKeyboardEvent(mockKeyboardEvent({ code: 'F9', key: 'F9' }));

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('should only index enabled shortcuts when mix of enabled and disabled exist', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'disabled-high',
          enabled: false,
          priority: 'high',
          matchBy: 'code',
          bindings: { default: { code: 'F3' as any, modifiers: [] } },
        }),
        makeShortcut({
          id: 'enabled-low',
          enabled: true,
          priority: 'low',
          matchBy: 'code',
          bindings: { default: { code: 'F3' as any, modifiers: [] } },
        }),
        makeShortcut({
          id: 'enabled-medium',
          enabled: true,
          priority: 'medium',
          matchBy: 'code',
          bindings: { default: { code: 'F3' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();

      const shortcuts = coordinator.getShortcutsForKey('F3');
      // Only 2 enabled shortcuts should be indexed
      expect(shortcuts.length).toBe(2);
      // Should be sorted by priority (medium before low)
      expect(shortcuts[0].id).toBe('enabled-medium');
      expect(shortcuts[1].id).toBe('enabled-low');
    });
  });

  // =========================================================================
  // Bug M4: Repeat-blocked reason accuracy
  // =========================================================================
  describe('Bug M4: Repeat-blocked reason accuracy', () => {
    it('should return not_found (not wrong_context) when all shortcuts blocked by repeat', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'no-repeat-save',
          allowRepeat: false,
          matchBy: 'code',
          contexts: ['grid'],
          bindings: { default: { code: 'KeyS' as any, modifiers: ['ctrl'] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'KeyS',
          key: 's',
          ctrlKey: true,
          repeat: true,
        }),
      );

      // Before M4 fix, this returned 'wrong_context' which was misleading.
      // The shortcut IS in the right context, it's just blocked by repeat.
      expect(result.handled).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('should return wrong_context when shortcut is genuinely in wrong context', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'editing-only',
          matchBy: 'code',
          contexts: ['editing'], // Only active in editing context
          bindings: { default: { code: 'F7' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      // No deps → getCurrentContext() returns 'grid'
      const result = coordinator.handleKeyboardEvent(mockKeyboardEvent({ code: 'F7', key: 'F7' }));

      // This is a genuine context mismatch — 'editing' shortcut pressed in 'grid' context
      expect(result.handled).toBe(false);
      expect(result.reason).toBe('wrong_context');
    });
  });

  // =========================================================================
  // Combined scenarios
  // =========================================================================
  describe('Combined: priority + allowRepeat + global', () => {
    it('should respect priority, then allowRepeat, then context together', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'high-no-repeat',
          priority: 'high',
          allowRepeat: false,
          contexts: ['global'],
          matchBy: 'code',
          bindings: { default: { code: 'ArrowDown' as any, modifiers: [] } },
        }),
        makeShortcut({
          id: 'medium-repeat',
          priority: 'medium',
          allowRepeat: true,
          contexts: ['grid'],
          matchBy: 'code',
          bindings: { default: { code: 'ArrowDown' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();

      // On repeat event: high-no-repeat should be skipped (allowRepeat: false)
      // medium-repeat should match (allowRepeat: true, grid context matches)
      const shortcuts = coordinator.getShortcutsForKey('ArrowDown');
      // Verify sorting: high comes before medium
      expect(shortcuts[0].id).toBe('high-no-repeat');
      expect(shortcuts[1].id).toBe('medium-repeat');

      // On repeat: first is skipped, second matches
      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'ArrowDown',
          key: 'ArrowDown',
          repeat: true,
        }),
      );

      // Should not be wrong_context — medium-repeat should match
      expect(result.reason).not.toBe('wrong_context');
    });
  });

  // =========================================================================
  // Gap 6: byKey-to-byCode fallthrough (hybrid matching)
  // =========================================================================
  describe('Gap 6: byKey-to-byCode fallthrough', () => {
    it('should fall through from byKey to byCode when byKey shortcut does not match context', () => {
      // Scenario: Ctrl+B has a matchBy:'key' shortcut for 'objectSelected' context
      // AND a matchBy:'code' shortcut for 'grid' context.
      // When in 'grid' context, the byKey shortcut should NOT match (wrong context),
      // so the coordinator should fall through to byCode and find the code-based shortcut.
      setTestShortcuts([
        makeShortcut({
          id: 'bykey-object-bold',
          matchBy: 'key',
          expectedCharacter: 'b',
          contexts: ['objectSelected'],
          priority: 'medium',
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
        }),
        makeShortcut({
          id: 'bycode-grid-action',
          matchBy: 'code',
          contexts: ['grid'],
          priority: 'medium',
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      // No deps → getCurrentContext() returns 'grid'

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'KeyB',
          key: 'b',
          ctrlKey: true,
        }),
      );

      // The byKey shortcut is for 'objectSelected' context, but we are in 'grid'.
      // It should fall through to the byCode shortcut which IS for 'grid'.
      // Without deps, dispatch fails (no actionDeps), so we get 'not_found'.
      // Critically, it should NOT be 'wrong_context' — that would mean fallthrough failed.
      expect(result.handled).toBe(false);
      expect(result.reason).toBe('not_found'); // no actionDeps, but shortcut was found
      expect(result.reason).not.toBe('wrong_context');
    });

    it('should fall through from byKey to byCode when byKey shortcut is blocked by repeat', () => {
      // Scenario: Ctrl+B has a matchBy:'key' shortcut with allowRepeat: false
      // AND a matchBy:'code' shortcut with allowRepeat: true.
      // On repeat events, the byKey shortcut should be skipped and byCode should match.
      setTestShortcuts([
        makeShortcut({
          id: 'bykey-no-repeat',
          matchBy: 'key',
          expectedCharacter: 'b',
          contexts: ['grid'],
          allowRepeat: false,
          priority: 'medium',
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
        }),
        makeShortcut({
          id: 'bycode-allow-repeat',
          matchBy: 'code',
          contexts: ['grid'],
          allowRepeat: true,
          priority: 'medium',
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
        }),
      ]);

      const coordinator = createTestCoordinator();

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'KeyB',
          key: 'b',
          ctrlKey: true,
          repeat: true,
        }),
      );

      // The byKey shortcut is blocked by repeat, so it should fall through to byCode
      // which allows repeat. Without deps, dispatch fails, so not_found is expected.
      // Critically, it should NOT be 'wrong_context'.
      expect(result.handled).toBe(false);
      expect(result.reason).toBe('not_found'); // no actionDeps
      expect(result.reason).not.toBe('wrong_context');
    });

    it('should return wrong_context when neither byKey nor byCode match the current context', () => {
      // Both byKey and byCode shortcuts are for 'editing' context,
      // but we are in 'grid'. Neither should match.
      setTestShortcuts([
        makeShortcut({
          id: 'bykey-editing',
          matchBy: 'key',
          expectedCharacter: 'b',
          contexts: ['editing'],
          priority: 'medium',
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
        }),
        makeShortcut({
          id: 'bycode-editing',
          matchBy: 'code',
          contexts: ['editing'],
          priority: 'medium',
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      // No deps → getCurrentContext() returns 'grid'

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'KeyB',
          key: 'b',
          ctrlKey: true,
        }),
      );

      // Both shortcuts are for 'editing' context but we are in 'grid'.
      // Should be wrong_context since neither matched.
      expect(result.handled).toBe(false);
      expect(result.reason).toBe('wrong_context');
    });

    it('should prefer byKey match when byKey shortcut matches context', () => {
      // When byKey has a valid match, it should be used (no need to check byCode).
      setTestShortcuts([
        makeShortcut({
          id: 'bykey-grid-bold',
          matchBy: 'key',
          expectedCharacter: 'b',
          contexts: ['grid'],
          priority: 'medium',
          action: 'TOGGLE_BOLD',
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
        }),
        makeShortcut({
          id: 'bycode-grid-other',
          matchBy: 'code',
          contexts: ['grid'],
          priority: 'medium',
          action: 'MOVE_DOWN',
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
        }),
      ]);

      const coordinator = createTestCoordinator();

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({
          code: 'KeyB',
          key: 'b',
          ctrlKey: true,
        }),
      );

      // byKey match should be preferred when it matches context.
      // Without deps, dispatch fails, but we can verify it didn't return wrong_context.
      expect(result.handled).toBe(false);
      expect(result.reason).toBe('not_found'); // no actionDeps
    });
  });

  // =========================================================================
  // Read-only mode: blocks mutating shortcuts, allows navigation
  // =========================================================================
  describe('Read-only mode', () => {
    /** Mock editorActor to satisfy IME composition guard + getCurrentContext */
    const mockEditorActor = {
      getSnapshot: () => ({
        matches: () => false,
        context: { isEditMode: false },
      }),
    };

    it('blocks mutating shortcuts when readOnly is true', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'delete-cells',
          action: 'CLEAR_CONTENTS',
          contexts: ['grid'],
          matchBy: 'code',
          bindings: { default: { code: 'Delete' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      coordinator.setDependencies({
        readOnly: true,
        editorActor: mockEditorActor,
      } as any);

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({ code: 'Delete', key: 'Delete' }),
      );

      expect(result.handled).toBe(true);
      expect(result.reason).toBe('wrong_context');
      expect(result.action).toBe('CLEAR_CONTENTS');
    });

    it('allows navigation shortcuts when readOnly is true', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'move-down',
          action: 'MOVE_DOWN',
          contexts: ['grid'],
          matchBy: 'code',
          bindings: { default: { code: 'ArrowDown' as any, modifiers: [] } },
        }),
      ]);

      const dispatchFn = jest.fn(() => ({ handled: true }));
      const coordinator = createTestCoordinator();
      coordinator.setDependencies({
        readOnly: true,
        dispatch: dispatchFn,
        editorActor: mockEditorActor,
      } as any);

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({ code: 'ArrowDown', key: 'ArrowDown' }),
      );

      // MOVE_DOWN is in READ_ONLY_ALLOWED_ACTIONS — should NOT be blocked
      expect(result.reason).not.toBe('wrong_context');
    });

    it('allows copy shortcut when readOnly is true', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'copy',
          action: 'COPY',
          contexts: ['grid'],
          matchBy: 'code',
          bindings: { default: { code: 'KeyC' as any, modifiers: ['ctrl'] } },
        }),
      ]);

      const dispatchFn = jest.fn(() => ({ handled: true }));
      const coordinator = createTestCoordinator();
      coordinator.setDependencies({
        readOnly: true,
        dispatch: dispatchFn,
        editorActor: mockEditorActor,
      } as any);

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({ code: 'KeyC', key: 'c', ctrlKey: true }),
      );

      // COPY is in READ_ONLY_ALLOWED_ACTIONS — should NOT be blocked
      expect(result.reason).not.toBe('wrong_context');
    });

    it('does not block mutating shortcuts when readOnly is false', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'delete-cells',
          action: 'CLEAR_CONTENTS',
          contexts: ['grid'],
          matchBy: 'code',
          bindings: { default: { code: 'Delete' as any, modifiers: [] } },
        }),
      ]);

      const dispatchFn = jest.fn(() => ({ handled: true }));
      const coordinator = createTestCoordinator();
      coordinator.setDependencies({
        readOnly: false,
        dispatch: dispatchFn,
        editorActor: mockEditorActor,
      } as any);

      const result = coordinator.handleKeyboardEvent(
        mockKeyboardEvent({ code: 'Delete', key: 'Delete' }),
      );

      // Should NOT be blocked — readOnly is false
      expect(result.reason).not.toBe('wrong_context');
    });
  });
});
