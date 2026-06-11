/**
 * KeyboardCoordinator Full Dispatch Tests
 *
 * Tests the full dispatch path through KeyboardCoordinator:
 * event -> lookup -> context check -> dispatch -> action result
 *
 * Unlike keyboard-coordinator.test.ts (which tests lookup table behavior
 * without dependencies), these tests wire real KeyboardCoordinatorDependencies
 * with stub actors and a recording dispatch spy.
 *
 */

import { jest } from '@jest/globals';

import type { KeyboardShortcut } from '@mog-sdk/contracts/keyboard';
import { createKeyEvent, createKeyboardDeps } from '../keyboard-test-utils';

// ---------------------------------------------------------------------------
// Test shortcut factory (replicates pattern from keyboard-coordinator.test.ts)
// ---------------------------------------------------------------------------

function makeShortcut(overrides: Partial<KeyboardShortcut> & { id: string }): KeyboardShortcut {
  return {
    bindings: {
      default: { code: 'KeyB' as any, modifiers: ['ctrl'] },
    },
    description: `Test shortcut ${overrides.id}`,
    action: `ACTION_${overrides.id.toUpperCase()}`,
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
// Mock KEYBOARD_SHORTCUTS — mutable array for per-test control
// ---------------------------------------------------------------------------

const TEST_SHORTCUTS: KeyboardShortcut[] = [];

jest.mock('../../../../keyboard', () => ({
  ...jest.requireActual('../../../../keyboard'),
  KEYBOARD_SHORTCUTS: TEST_SHORTCUTS,
}));

// Mock the actions module to break the deep dependency chain
jest.mock('../../../../actions', () => ({
  dispatch: jest.fn(() => ({ handled: true })),
}));

// Import AFTER mocks are set up
import { KeyboardCoordinator } from '../../keyboard/keyboard-coordinator';

/** Replace TEST_SHORTCUTS contents in-place so the captured reference stays valid. */
function setTestShortcuts(shortcuts: KeyboardShortcut[]): void {
  TEST_SHORTCUTS.length = 0;
  TEST_SHORTCUTS.push(...shortcuts);
}

function createTestCoordinator(): KeyboardCoordinator {
  return new KeyboardCoordinator('windows', TEST_SHORTCUTS);
}

function withTarget(event: KeyboardEvent, target: EventTarget): KeyboardEvent {
  Object.defineProperty(event, 'target', {
    configurable: true,
    value: target,
  });
  return event;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KeyboardCoordinator full dispatch', () => {
  beforeEach(() => {
    // Clear shortcuts before each test
    TEST_SHORTCUTS.length = 0;
  });

  // =========================================================================
  // Grid context
  // =========================================================================
  describe('grid context', () => {
    it('Ctrl+B dispatches TOGGLE_BOLD', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'toggle-bold',
          action: 'TOGGLE_BOLD',
          matchBy: 'code',
          contexts: ['grid'],
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      const deps = createKeyboardDeps({ editorState: 'idle' });
      coordinator.setDependencies(deps);

      const event = createKeyEvent('KeyB', { ctrlKey: true, key: 'b' });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('TOGGLE_BOLD');
      expect(deps.dispatch).toHaveBeenCalled();
      // Verify the action name passed to dispatch
      expect(deps.dispatch).toHaveBeenCalledWith('TOGGLE_BOLD', expect.any(Object), undefined);
    });

    it('ArrowDown dispatches navigation action', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'move-down',
          action: 'MOVE_DOWN',
          matchBy: 'code',
          contexts: ['grid'],
          allowRepeat: true,
          bindings: { default: { code: 'ArrowDown' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      const deps = createKeyboardDeps({ editorState: 'idle' });
      coordinator.setDependencies(deps);

      const event = createKeyEvent('ArrowDown', { key: 'ArrowDown' });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('MOVE_DOWN');
      expect(deps.dispatch).toHaveBeenCalledWith('MOVE_DOWN', expect.any(Object), undefined);
    });
  });

  // =========================================================================
  // Editing context
  // =========================================================================
  describe('editing context', () => {
    it('Enter dispatches COMMIT_EDIT action', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'commit-edit',
          action: 'COMMIT_EDIT',
          matchBy: 'code',
          contexts: ['editing'],
          bindings: { default: { code: 'Enter' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      const deps = createKeyboardDeps({ editorState: 'editing', isEditMode: true });
      coordinator.setDependencies(deps);

      const event = createKeyEvent('Enter', { key: 'Enter' });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('COMMIT_EDIT');
      expect(deps.dispatch).toHaveBeenCalledWith('COMMIT_EDIT', expect.any(Object), undefined);
    });

    it('Tab dispatches commit and move right', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'commit-tab',
          action: 'COMMIT_AND_MOVE_RIGHT',
          matchBy: 'code',
          contexts: ['editing'],
          bindings: { default: { code: 'Tab' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      const deps = createKeyboardDeps({ editorState: 'editing', isEditMode: false });
      coordinator.setDependencies(deps);

      const event = createKeyEvent('Tab', { key: 'Tab' });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('COMMIT_AND_MOVE_RIGHT');
      expect(deps.dispatch).toHaveBeenCalledWith(
        'COMMIT_AND_MOVE_RIGHT',
        expect.any(Object),
        undefined,
      );
    });

    it('Escape dispatches cancel edit', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'cancel-edit',
          action: 'CANCEL_EDIT',
          matchBy: 'code',
          contexts: ['editing'],
          bindings: { default: { code: 'Escape' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      const deps = createKeyboardDeps({ editorState: 'editing', isEditMode: true });
      coordinator.setDependencies(deps);

      const event = createKeyEvent('Escape', { key: 'Escape' });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('CANCEL_EDIT');
      expect(deps.dispatch).toHaveBeenCalledWith('CANCEL_EDIT', expect.any(Object), undefined);
    });

    it('lets focused chrome text inputs own Enter while editing is active', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'commit-enter-mode',
          action: 'COMMIT_EDIT',
          matchBy: 'code',
          contexts: ['enterMode'],
          bindings: { default: { code: 'Enter' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      const deps = createKeyboardDeps({ editorState: 'editing', isEditMode: false });
      coordinator.setDependencies(deps);

      const input = document.createElement('input');
      input.setAttribute('data-testid', 'name-box');
      const event = withTarget(createKeyEvent('Enter', { key: 'Enter' }), input);
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('not_found');
      expect(deps.dispatch).not.toHaveBeenCalled();
    });

    it('keeps routing Enter from the inline cell editor through spreadsheet editing', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'commit-enter-mode',
          action: 'COMMIT_EDIT',
          matchBy: 'code',
          contexts: ['enterMode'],
          bindings: { default: { code: 'Enter' as any, modifiers: [] } },
        }),
      ]);

      const coordinator = createTestCoordinator();
      const deps = createKeyboardDeps({ editorState: 'editing', isEditMode: false });
      coordinator.setDependencies(deps);

      const textarea = document.createElement('textarea');
      textarea.setAttribute('data-testid', 'inline-cell-editor');
      const event = withTarget(createKeyEvent('Enter', { key: 'Enter' }), textarea);
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('COMMIT_EDIT');
      expect(deps.dispatch).toHaveBeenCalledWith('COMMIT_EDIT', expect.any(Object), undefined);
    });
  });

  // =========================================================================
  // IME composing
  // =========================================================================
  describe('IME composing', () => {
    it('returns { handled: false, reason: "ime_composing" } when isComposing', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'some-action',
          action: 'SOME_ACTION',
          matchBy: 'code',
          contexts: ['grid'],
          bindings: { default: { code: 'KeyA' as any, modifiers: [] } },
        }),
      ]);

      const deps = createKeyboardDeps({ editorState: 'idle' });
      const coordinator = createTestCoordinator();
      coordinator.setDependencies(deps);

      const event = createKeyEvent('KeyA', { isComposing: true });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('ime_composing');
      // dispatch should NOT have been called
      expect(deps.dispatch).not.toHaveBeenCalled();
    });

    it('returns ime_composing when keyCode is 229', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'some-action',
          action: 'SOME_ACTION',
          matchBy: 'code',
          contexts: ['grid'],
          bindings: { default: { code: 'KeyA' as any, modifiers: [] } },
        }),
      ]);

      const deps = createKeyboardDeps({ editorState: 'idle' });
      const coordinator = createTestCoordinator();
      coordinator.setDependencies(deps);

      // keyCode 229 is the "Process" key indicating IME processing
      const event = createKeyEvent('KeyA', { keyCode: 229 });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('ime_composing');
      expect(deps.dispatch).not.toHaveBeenCalled();
    });

    it('returns ime_composing when editor machine is in imeComposing state', () => {
      setTestShortcuts([
        makeShortcut({
          id: 'some-action',
          action: 'SOME_ACTION',
          matchBy: 'code',
          contexts: ['grid'],
          bindings: { default: { code: 'KeyA' as any, modifiers: [] } },
        }),
      ]);

      // Editor machine is in imeComposing state (Layer 2 defense)
      const deps = createKeyboardDeps({ editorState: 'imeComposing' });
      const coordinator = createTestCoordinator();
      coordinator.setDependencies(deps);

      // The event itself does not have isComposing=true or keyCode=229
      // but the machine state catches it as a fallback
      const event = createKeyEvent('KeyA', { key: 'a' });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('ime_composing');
      expect(deps.dispatch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // F8 extend mode
  // =========================================================================
  // Extend mode now lives in `ctx.modes.extend` on the selection actor.
  // The coordinator's `resolveSelectionAction` reads the snapshot to route
  // ArrowKey under Extend → EXTEND_SELECTION_*. Extend is sticky (no
  // auto-deactivation), so the test only asserts on the dispatched action.
  // =========================================================================
  describe('F8 extend mode', () => {
    it('ArrowDown dispatches EXTEND_SELECTION_DOWN when extend mode active', () => {
      setTestShortcuts([]);

      const deps = createKeyboardDeps({ editorState: 'idle', extendSelectionMode: true });
      const coordinator = createTestCoordinator();
      coordinator.setDependencies(deps);

      const event = createKeyEvent('ArrowDown', { key: 'ArrowDown' });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('EXTEND_SELECTION_DOWN');
      expect(deps.dispatch).toHaveBeenCalledWith('EXTEND_SELECTION_DOWN', expect.any(Object));
    });
  });

  // =========================================================================
  // End mode
  // =========================================================================
  // End mode lives in `ctx.modes.end` on the selection actor. The
  // coordinator's `resolveSelectionAction` routes ArrowKey under End →
  // MOVE_TO_EDGE_* (or EXTEND_TO_EDGE_* with Shift) and Home → MOVE_TO_LAST_USED_CELL.
  // After dispatch the coordinator sends `{ type: 'SET_MODE', mode: 'end',
  // value: false }` to the selection actor so the next key returns to
  // default routing — tests assert on the actor's `.send` calls.
  // =========================================================================
  describe('End mode', () => {
    it('End + ArrowDown dispatches MOVE_TO_EDGE_DOWN and clears end mode', () => {
      setTestShortcuts([]);

      const deps = createKeyboardDeps({ editorState: 'idle', endMode: true });
      const coordinator = createTestCoordinator();
      coordinator.setDependencies(deps);

      const event = createKeyEvent('ArrowDown', { key: 'ArrowDown' });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('MOVE_TO_EDGE_DOWN');
      expect(deps.dispatch).toHaveBeenCalledWith('MOVE_TO_EDGE_DOWN', expect.any(Object));
      // Coordinator clears end mode by sending SET_MODE to the selection actor.
      expect(deps.selectionActor.send).toHaveBeenCalledWith({
        type: 'SET_MODE',
        mode: 'end',
        value: false,
      });
    });

    it('End + Shift+ArrowDown dispatches EXTEND_TO_EDGE_DOWN', () => {
      setTestShortcuts([]);

      const deps = createKeyboardDeps({ editorState: 'idle', endMode: true });
      const coordinator = createTestCoordinator();
      coordinator.setDependencies(deps);

      const event = createKeyEvent('ArrowDown', { key: 'ArrowDown', shiftKey: true });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('EXTEND_TO_EDGE_DOWN');
      expect(deps.dispatch).toHaveBeenCalledWith('EXTEND_TO_EDGE_DOWN', expect.any(Object));
      expect(deps.selectionActor.send).toHaveBeenCalledWith({
        type: 'SET_MODE',
        mode: 'end',
        value: false,
      });
    });

    it('End + Home dispatches MOVE_TO_LAST_USED_CELL', () => {
      setTestShortcuts([]);

      const deps = createKeyboardDeps({ editorState: 'idle', endMode: true });
      const coordinator = createTestCoordinator();
      coordinator.setDependencies(deps);

      const event = createKeyEvent('Home', { key: 'Home' });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('MOVE_TO_LAST_USED_CELL');
      expect(deps.dispatch).toHaveBeenCalledWith('MOVE_TO_LAST_USED_CELL', expect.any(Object));
      expect(deps.selectionActor.send).toHaveBeenCalledWith({
        type: 'SET_MODE',
        mode: 'end',
        value: false,
      });
    });
  });

  // =========================================================================
  // No match
  // =========================================================================
  describe('no match', () => {
    it('unbound key returns { handled: false, reason: "not_found" }', () => {
      // Register a shortcut for a different key
      setTestShortcuts([
        makeShortcut({
          id: 'some-action',
          action: 'SOME_ACTION',
          matchBy: 'code',
          contexts: ['grid'],
          bindings: { default: { code: 'KeyB' as any, modifiers: ['ctrl'] } },
        }),
      ]);

      const deps = createKeyboardDeps({ editorState: 'idle' });
      const coordinator = createTestCoordinator();
      coordinator.setDependencies(deps);

      // Press a key that has no registered shortcut
      const event = createKeyEvent('F12', { key: 'F12' });
      const result = coordinator.handleKeyboardEvent(event);

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('not_found');
      expect(deps.dispatch).not.toHaveBeenCalled();
    });
  });
});
