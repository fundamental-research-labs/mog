/**
 * useKeyboard Hook Tests
 *
 * Tests for the React hook that provides unified keyboard handling.
 *
 * @module kernel/keyboard/hooks/__tests__/use-keyboard.test
 */

/**
 * NOTE: These tests require Jest to be configured with TypeScript support.
 * The current Jest babel configuration in /os doesn't support TypeScript.
 * When the babel config is updated to include @babel/preset-typescript,
 * these tests will run correctly.
 */

import { act, renderHook } from '@testing-library/react';
import React from 'react';

import type { KeyboardShortcut, ShortcutContext } from '@mog-sdk/kernel/keyboard';
import { createTestPlatformIdentity } from '@mog/platform/identity';
import { PlatformIdentityProvider } from '../../../context/platform-identity-context';
import type { UseKeyboardOptions } from '../use-keyboard';
import { useKeyboard } from '../use-keyboard';

const testIdentity = createTestPlatformIdentity();

function TestWrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(PlatformIdentityProvider, { value: testIdentity }, children);
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock KeyboardEvent for testing.
 */
function createMockKeyboardEvent(options: {
  key: string;
  code: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
}): KeyboardEvent {
  const event = {
    key: options.key,
    code: options.code,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
    isComposing: options.isComposing ?? false,
    keyCode: options.keyCode ?? 0,
    repeat: options.repeat ?? false,
    timeStamp: Date.now(),
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  } as unknown as KeyboardEvent;

  return event;
}

/**
 * Create a minimal test shortcut.
 */
function createTestShortcut(overrides: Partial<KeyboardShortcut> = {}): KeyboardShortcut {
  return {
    id: 'test.shortcut',
    description: 'Test shortcut',
    action: 'COPY',
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 'c',
    bindings: {
      default: { code: 'KeyC', modifiers: ['ctrl'] },
    },
    ...overrides,
  };
}

/**
 * Default hook options for testing.
 */
function createDefaultOptions(overrides?: Partial<UseKeyboardOptions>): UseKeyboardOptions {
  return {
    context: 'grid',
    shortcuts: [],
    platform: 'windows',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('useKeyboard', () => {
  describe('initialization', () => {
    it('should return all expected functions and properties', () => {
      const { result } = renderHook(() => useKeyboard(createDefaultOptions()), {
        wrapper: TestWrapper,
      });

      expect(result.current.process).toBeInstanceOf(Function);
      expect(result.current.classify).toBeInstanceOf(Function);
      expect(result.current.matchShortcut).toBeInstanceOf(Function);
      expect(result.current.handleKeyDown).toBeInstanceOf(Function);
      expect(result.current.getActiveShortcuts).toBeInstanceOf(Function);
      expect(result.current.platform).toBeDefined();
    });

    it('should use provided platform', () => {
      const { result } = renderHook(
        () => useKeyboard(createDefaultOptions({ platform: 'macos' })),
        { wrapper: TestWrapper },
      );

      expect(result.current.platform).toBe('macos');
    });

    it('should auto-detect platform when not provided', () => {
      const { result } = renderHook(() => useKeyboard({ context: 'grid' }), {
        wrapper: TestWrapper,
      });

      expect(['macos', 'windows', 'linux']).toContain(result.current.platform);
    });
  });

  describe('process()', () => {
    it('should normalize keyboard events', () => {
      const { result } = renderHook(() => useKeyboard(createDefaultOptions()), {
        wrapper: TestWrapper,
      });

      const event = createMockKeyboardEvent({
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
      });

      const input = result.current.process(event);

      expect(input.physicalKey).toBe('KeyC');
      expect(input.character).toBe('c');
      expect(input.modifiers.ctrl).toBe(true);
      expect(input.originalEvent).toBe(event);
    });
  });

  describe('classify()', () => {
    it('should classify shortcut input', () => {
      const { result } = renderHook(() => useKeyboard(createDefaultOptions()), {
        wrapper: TestWrapper,
      });

      const event = createMockKeyboardEvent({
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
      });

      const input = result.current.process(event);
      const classified = result.current.classify(input);

      expect(classified.type).toBe('shortcut');
    });

    it('should classify character input', () => {
      const { result } = renderHook(() => useKeyboard(createDefaultOptions()), {
        wrapper: TestWrapper,
      });

      const event = createMockKeyboardEvent({
        key: 'a',
        code: 'KeyA',
      });

      const input = result.current.process(event);
      const classified = result.current.classify(input);

      expect(classified.type).toBe('character');
      expect(classified.isPrintable).toBe(true);
    });

    it('should classify navigation input', () => {
      const { result } = renderHook(() => useKeyboard(createDefaultOptions()), {
        wrapper: TestWrapper,
      });

      const event = createMockKeyboardEvent({
        key: 'ArrowUp',
        code: 'ArrowUp',
      });

      const input = result.current.process(event);
      const classified = result.current.classify(input);

      expect(classified.type).toBe('navigation');
    });

    it('should classify action input', () => {
      const { result } = renderHook(() => useKeyboard(createDefaultOptions()), {
        wrapper: TestWrapper,
      });

      const event = createMockKeyboardEvent({
        key: 'Enter',
        code: 'Enter',
      });

      const input = result.current.process(event);
      const classified = result.current.classify(input);

      expect(classified.type).toBe('action');
    });

    it('should classify composition input', () => {
      const { result } = renderHook(() => useKeyboard(createDefaultOptions()), {
        wrapper: TestWrapper,
      });

      const event = createMockKeyboardEvent({
        key: 'Process',
        code: '',
        isComposing: true,
      });

      const input = result.current.process(event);
      const classified = result.current.classify(input);

      expect(classified.type).toBe('composition');
    });
  });

  describe('matchShortcut()', () => {
    it('should match shortcuts in current context', () => {
      const shortcut = createTestShortcut({
        id: 'copy',
        action: 'COPY',
        contexts: ['grid'],
        matchBy: 'key',
        expectedCharacter: 'c',
        bindings: {
          default: { code: 'KeyC', modifiers: ['ctrl'] },
        },
      });

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [shortcut],
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
      });

      const input = result.current.process(event);
      const matched = result.current.matchShortcut(input);

      expect(matched).not.toBeNull();
      expect(matched?.id).toBe('copy');
      expect(matched?.action).toBe('COPY');
    });

    it('should not match shortcuts in wrong context', () => {
      const shortcut = createTestShortcut({
        id: 'copy',
        action: 'COPY',
        contexts: ['editing'], // Only active in editing
        matchBy: 'key',
        expectedCharacter: 'c',
        bindings: {
          default: { code: 'KeyC', modifiers: ['ctrl'] },
        },
      });

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid', // We're in grid context
              shortcuts: [shortcut],
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
      });

      const input = result.current.process(event);
      const matched = result.current.matchShortcut(input);

      expect(matched).toBeNull();
    });

    it('should match shortcuts with "any" context', () => {
      const shortcut = createTestShortcut({
        id: 'save',
        action: 'SAVE',
        contexts: ['any'],
        matchBy: 'key',
        expectedCharacter: 's',
        bindings: {
          default: { code: 'KeyS', modifiers: ['ctrl'] },
        },
      });

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'editing',
              shortcuts: [shortcut],
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 's',
        code: 'KeyS',
        ctrlKey: true,
      });

      const input = result.current.process(event);
      const matched = result.current.matchShortcut(input);

      expect(matched).not.toBeNull();
      expect(matched?.id).toBe('save');
    });

    it('should not match disabled shortcuts', () => {
      const shortcut = createTestShortcut({
        id: 'copy',
        action: 'COPY',
        enabled: false, // Disabled
        contexts: ['grid'],
        matchBy: 'key',
        expectedCharacter: 'c',
        bindings: {
          default: { code: 'KeyC', modifiers: ['ctrl'] },
        },
      });

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [shortcut],
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
      });

      const input = result.current.process(event);
      const matched = result.current.matchShortcut(input);

      expect(matched).toBeNull();
    });

    it('should not match during IME composition', () => {
      const shortcut = createTestShortcut({
        id: 'copy',
        action: 'COPY',
        contexts: ['grid'],
        matchBy: 'key',
        expectedCharacter: 'c',
        bindings: {
          default: { code: 'KeyC', modifiers: ['ctrl'] },
        },
      });

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [shortcut],
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        isComposing: true, // IME active
      });

      const input = result.current.process(event);
      const matched = result.current.matchShortcut(input);

      expect(matched).toBeNull();
    });
  });

  describe('handleKeyDown()', () => {
    it('should call onShortcut when shortcut matches', () => {
      const onShortcut = jest.fn();
      const shortcut = createTestShortcut({
        id: 'copy',
        action: 'COPY',
        contexts: ['grid'],
        matchBy: 'key',
        expectedCharacter: 'c',
        bindings: {
          default: { code: 'KeyC', modifiers: ['ctrl'] },
        },
      });

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [shortcut],
              onShortcut,
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
      });

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onShortcut).toHaveBeenCalledTimes(1);
      expect(onShortcut).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'copy' }),
        expect.objectContaining({ physicalKey: 'KeyC' }),
      );
    });

    it('should call onCharacter for printable characters', () => {
      const onCharacter = jest.fn();

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [],
              onCharacter,
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'a',
        code: 'KeyA',
      });

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onCharacter).toHaveBeenCalledTimes(1);
      expect(onCharacter).toHaveBeenCalledWith('a', expect.objectContaining({ character: 'a' }));
    });

    it('should call onNavigation for arrow keys', () => {
      const onNavigation = jest.fn();

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [],
              onNavigation,
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'ArrowUp',
        code: 'ArrowUp',
      });

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onNavigation).toHaveBeenCalledTimes(1);
      expect(onNavigation).toHaveBeenCalledWith(
        expect.objectContaining({ physicalKey: 'ArrowUp' }),
      );
    });

    it('should call onAction for Enter key', () => {
      const onAction = jest.fn();

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [],
              onAction,
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'Enter',
        code: 'Enter',
      });

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ physicalKey: 'Enter' }));
    });

    it('should not call any handler during IME composition', () => {
      const onShortcut = jest.fn();
      const onCharacter = jest.fn();
      const onNavigation = jest.fn();
      const onAction = jest.fn();

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [],
              onShortcut,
              onCharacter,
              onNavigation,
              onAction,
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'a',
        code: 'KeyA',
        isComposing: true,
      });

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onShortcut).not.toHaveBeenCalled();
      expect(onCharacter).not.toHaveBeenCalled();
      expect(onNavigation).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    });

    it('should not call any handler when disabled', () => {
      const onShortcut = jest.fn();
      const onCharacter = jest.fn();

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [],
              onShortcut,
              onCharacter,
              enabled: false, // Disabled
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'a',
        code: 'KeyA',
      });

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onShortcut).not.toHaveBeenCalled();
      expect(onCharacter).not.toHaveBeenCalled();
    });

    it('should not call handlers for modifier-only keys', () => {
      const onShortcut = jest.fn();
      const onCharacter = jest.fn();

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [],
              onShortcut,
              onCharacter,
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'Shift',
        code: 'ShiftLeft',
      });

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(onShortcut).not.toHaveBeenCalled();
      expect(onCharacter).not.toHaveBeenCalled();
    });

    it('should respect browser defer policy', () => {
      const onShortcut = jest.fn();
      const shortcut = createTestShortcut({
        id: 'fullscreen',
        action: 'FULL_SCREEN',
        contexts: ['grid'],
        matchBy: 'code',
        bindings: {
          default: { code: 'F11', modifiers: [] },
        },
        browserConflict: {
          conflictsWith: 'Browser fullscreen',
          policy: 'defer', // Defer to browser
        },
      });

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [shortcut],
              onShortcut,
            }),
          ),
        { wrapper: TestWrapper },
      );

      const event = createMockKeyboardEvent({
        key: 'F11',
        code: 'F11',
      });

      act(() => {
        result.current.handleKeyDown(event);
      });

      // Should not call handler due to defer policy
      expect(onShortcut).not.toHaveBeenCalled();
    });
  });

  describe('getActiveShortcuts()', () => {
    it('should return shortcuts active in current context', () => {
      const gridShortcut = createTestShortcut({
        id: 'copy',
        action: 'COPY',
        contexts: ['grid'],
        matchBy: 'key',
        expectedCharacter: 'c',
        bindings: { default: { code: 'KeyC', modifiers: ['ctrl'] } },
      });

      const editingShortcut = createTestShortcut({
        id: 'undo',
        action: 'UNDO',
        contexts: ['editing'],
        matchBy: 'key',
        expectedCharacter: 'z',
        bindings: { default: { code: 'KeyZ', modifiers: ['ctrl'] } },
      });

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [gridShortcut, editingShortcut],
            }),
          ),
        { wrapper: TestWrapper },
      );

      const activeShortcuts = result.current.getActiveShortcuts();

      expect(activeShortcuts).toHaveLength(1);
      expect(activeShortcuts[0].id).toBe('copy');
    });

    it('should include shortcuts with "any" context', () => {
      const gridShortcut = createTestShortcut({
        id: 'copy',
        action: 'COPY',
        contexts: ['grid'],
        matchBy: 'key',
        expectedCharacter: 'c',
        bindings: { default: { code: 'KeyC', modifiers: ['ctrl'] } },
      });

      const globalShortcut = createTestShortcut({
        id: 'save',
        action: 'SAVE',
        contexts: ['any'],
        matchBy: 'key',
        expectedCharacter: 's',
        bindings: { default: { code: 'KeyS', modifiers: ['ctrl'] } },
      });

      const { result } = renderHook(
        () =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: [gridShortcut, globalShortcut],
            }),
          ),
        { wrapper: TestWrapper },
      );

      const activeShortcuts = result.current.getActiveShortcuts();

      expect(activeShortcuts).toHaveLength(2);
      expect(activeShortcuts.map((s) => s.id).sort()).toEqual(['copy', 'save']);
    });
  });

  describe('context changes', () => {
    it('should update shortcut matching when context changes', () => {
      const shortcut = createTestShortcut({
        id: 'copy',
        action: 'COPY',
        contexts: ['grid'],
        matchBy: 'key',
        expectedCharacter: 'c',
        bindings: { default: { code: 'KeyC', modifiers: ['ctrl'] } },
      });

      const { result, rerender } = renderHook(
        (props: { context: ShortcutContext }) =>
          useKeyboard(
            createDefaultOptions({
              context: props.context,
              shortcuts: [shortcut],
            }),
          ),
        { wrapper: TestWrapper, initialProps: { context: 'grid' as ShortcutContext } },
      );

      // Should match in grid context
      let event = createMockKeyboardEvent({
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
      });
      let input = result.current.process(event);
      expect(result.current.matchShortcut(input)).not.toBeNull();

      // Change to editing context
      rerender({ context: 'editing' as ShortcutContext });

      // Should not match in editing context
      event = createMockKeyboardEvent({
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
      });
      input = result.current.process(event);
      expect(result.current.matchShortcut(input)).toBeNull();
    });
  });

  describe('shortcut updates', () => {
    it('should rebuild matcher when shortcuts change', () => {
      const shortcut1 = createTestShortcut({
        id: 'copy',
        action: 'COPY',
        contexts: ['grid'],
        matchBy: 'key',
        expectedCharacter: 'c',
        bindings: { default: { code: 'KeyC', modifiers: ['ctrl'] } },
      });

      const shortcut2 = createTestShortcut({
        id: 'paste',
        action: 'PASTE',
        contexts: ['grid'],
        matchBy: 'key',
        expectedCharacter: 'v',
        bindings: { default: { code: 'KeyV', modifiers: ['ctrl'] } },
      });

      const { result, rerender } = renderHook(
        (props: { shortcuts: KeyboardShortcut[] }) =>
          useKeyboard(
            createDefaultOptions({
              context: 'grid',
              shortcuts: props.shortcuts,
            }),
          ),
        { wrapper: TestWrapper, initialProps: { shortcuts: [shortcut1] } },
      );

      // Initially only copy is registered
      let event = createMockKeyboardEvent({
        key: 'v',
        code: 'KeyV',
        ctrlKey: true,
      });
      let input = result.current.process(event);
      expect(result.current.matchShortcut(input)).toBeNull();

      // Add paste shortcut
      rerender({ shortcuts: [shortcut1, shortcut2] });

      // Now paste should match
      event = createMockKeyboardEvent({
        key: 'v',
        code: 'KeyV',
        ctrlKey: true,
      });
      input = result.current.process(event);
      expect(result.current.matchShortcut(input)).not.toBeNull();
      expect(result.current.matchShortcut(input)?.id).toBe('paste');
    });
  });
});
