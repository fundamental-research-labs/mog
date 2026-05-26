/**
 * useKeyboardContext Hook Tests
 *
 * Tests for the context derivation hook.
 *
 * @module kernel/keyboard/hooks/__tests__/use-keyboard-context.test
 */

/**
 * NOTE: These tests require Jest to be configured with TypeScript support.
 * The current Jest babel configuration in /os doesn't support TypeScript.
 * When the babel config is updated to include @babel/preset-typescript,
 * these tests will run correctly.
 */

import { renderHook } from '@testing-library/react';

import type { UseKeyboardContextOptions } from '../use-keyboard-context';
import {
  isBlockingContext,
  isEditingContext,
  isFormulaEditingContext,
  supportsTypeToEdit,
  useKeyboardContext,
} from '../use-keyboard-context';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Default options for testing.
 */
function createDefaultOptions(
  overrides?: Partial<UseKeyboardContextOptions>,
): UseKeyboardContextOptions {
  return {
    isEditing: false,
    isEnterMode: true,
    isFormulaBarFocused: false,
    isObjectSelected: false,
    isDialogOpen: false,
    isMenuOpen: false,
    isEditingObjectText: false,
    ...overrides,
  };
}

// =============================================================================
// Tests: useKeyboardContext
// =============================================================================

describe('useKeyboardContext', () => {
  describe('default state (grid)', () => {
    it('should return grid when nothing is active', () => {
      const { result } = renderHook(() => useKeyboardContext(createDefaultOptions()));

      expect(result.current).toBe('grid');
    });
  });

  describe('dialog priority', () => {
    it('should return dialog when dialog is open', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isDialogOpen: true,
          }),
        ),
      );

      expect(result.current).toBe('dialog');
    });

    it('should prioritize dialog over menu', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isDialogOpen: true,
            isMenuOpen: true,
          }),
        ),
      );

      expect(result.current).toBe('dialog');
    });

    it('should prioritize dialog over object selection', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isDialogOpen: true,
            isObjectSelected: true,
          }),
        ),
      );

      expect(result.current).toBe('dialog');
    });

    it('should prioritize dialog over editing', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isDialogOpen: true,
            isEditing: true,
          }),
        ),
      );

      expect(result.current).toBe('dialog');
    });
  });

  describe('menu priority', () => {
    it('should return menu when menu is open', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isMenuOpen: true,
          }),
        ),
      );

      expect(result.current).toBe('menu');
    });

    it('should prioritize menu over object selection', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isMenuOpen: true,
            isObjectSelected: true,
          }),
        ),
      );

      expect(result.current).toBe('menu');
    });

    it('should prioritize menu over editing', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isMenuOpen: true,
            isEditing: true,
          }),
        ),
      );

      expect(result.current).toBe('menu');
    });
  });

  describe('object selection', () => {
    it('should return objectSelected when object is selected', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isObjectSelected: true,
          }),
        ),
      );

      expect(result.current).toBe('objectSelected');
    });

    it('should prioritize objectSelected over editing', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isObjectSelected: true,
            isEditing: true,
          }),
        ),
      );

      expect(result.current).toBe('objectSelected');
    });

    it('should return editing context when editing text in object', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isObjectSelected: true,
            isEditingObjectText: true,
            isEnterMode: true,
          }),
        ),
      );

      // When editing text in object, we're in editing context
      expect(result.current).toBe('enterMode');
    });
  });

  describe('editing modes', () => {
    describe('enter mode', () => {
      it('should return enterMode when editing in enter mode', () => {
        const { result } = renderHook(() =>
          useKeyboardContext(
            createDefaultOptions({
              isEditing: true,
              isEnterMode: true,
            }),
          ),
        );

        expect(result.current).toBe('enterMode');
      });

      it('should default to enter mode when editing without explicit mode', () => {
        const { result } = renderHook(() =>
          useKeyboardContext({
            isEditing: true,
            // isEnterMode not specified - should default to true
          }),
        );

        expect(result.current).toBe('enterMode');
      });
    });

    describe('edit mode', () => {
      it('should return editMode when editing in edit mode', () => {
        const { result } = renderHook(() =>
          useKeyboardContext(
            createDefaultOptions({
              isEditing: true,
              isEnterMode: false,
            }),
          ),
        );

        expect(result.current).toBe('editMode');
      });
    });

    describe('formula enter mode', () => {
      it('should return formulaEnterMode when formula bar focused in enter mode', () => {
        const { result } = renderHook(() =>
          useKeyboardContext(
            createDefaultOptions({
              isEditing: true,
              isEnterMode: true,
              isFormulaBarFocused: true,
            }),
          ),
        );

        expect(result.current).toBe('formulaEnterMode');
      });
    });

    describe('formula edit mode', () => {
      it('should return formulaEditMode when formula bar focused in edit mode', () => {
        const { result } = renderHook(() =>
          useKeyboardContext(
            createDefaultOptions({
              isEditing: true,
              isEnterMode: false,
              isFormulaBarFocused: true,
            }),
          ),
        );

        expect(result.current).toBe('formulaEditMode');
      });
    });
  });

  describe('editing object text', () => {
    it('should return enterMode when editing object text in enter mode', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isEditingObjectText: true,
            isEnterMode: true,
          }),
        ),
      );

      expect(result.current).toBe('enterMode');
    });

    it('should return editMode when editing object text in edit mode', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isEditingObjectText: true,
            isEnterMode: false,
          }),
        ),
      );

      expect(result.current).toBe('editMode');
    });

    it('should return formulaEnterMode when formula bar focused while editing object', () => {
      const { result } = renderHook(() =>
        useKeyboardContext(
          createDefaultOptions({
            isEditingObjectText: true,
            isEnterMode: true,
            isFormulaBarFocused: true,
          }),
        ),
      );

      expect(result.current).toBe('formulaEnterMode');
    });
  });

  describe('context transitions', () => {
    it('should update context when props change', () => {
      const { result, rerender } = renderHook(
        (props: UseKeyboardContextOptions) => useKeyboardContext(props),
        { initialProps: createDefaultOptions() },
      );

      expect(result.current).toBe('grid');

      // Start editing
      rerender(createDefaultOptions({ isEditing: true, isEnterMode: true }));
      expect(result.current).toBe('enterMode');

      // Switch to edit mode
      rerender(createDefaultOptions({ isEditing: true, isEnterMode: false }));
      expect(result.current).toBe('editMode');

      // Open dialog (should override editing)
      rerender(createDefaultOptions({ isEditing: true, isEnterMode: false, isDialogOpen: true }));
      expect(result.current).toBe('dialog');

      // Close dialog, still editing
      rerender(createDefaultOptions({ isEditing: true, isEnterMode: false }));
      expect(result.current).toBe('editMode');

      // Stop editing
      rerender(createDefaultOptions({ isEditing: false }));
      expect(result.current).toBe('grid');
    });
  });
});

// =============================================================================
// Tests: Helper Functions
// =============================================================================

describe('isEditingContext', () => {
  it('should return true for enterMode', () => {
    expect(isEditingContext('enterMode')).toBe(true);
  });

  it('should return true for editMode', () => {
    expect(isEditingContext('editMode')).toBe(true);
  });

  it('should return true for formulaEnterMode', () => {
    expect(isEditingContext('formulaEnterMode')).toBe(true);
  });

  it('should return true for formulaEditMode', () => {
    expect(isEditingContext('formulaEditMode')).toBe(true);
  });

  it('should return true for editing', () => {
    expect(isEditingContext('editing')).toBe(true);
  });

  it('should return false for grid', () => {
    expect(isEditingContext('grid')).toBe(false);
  });

  it('should return false for objectSelected', () => {
    expect(isEditingContext('objectSelected')).toBe(false);
  });

  it('should return false for dialog', () => {
    expect(isEditingContext('dialog')).toBe(false);
  });

  it('should return false for menu', () => {
    expect(isEditingContext('menu')).toBe(false);
  });
});

describe('isFormulaEditingContext', () => {
  it('should return true for formulaEnterMode', () => {
    expect(isFormulaEditingContext('formulaEnterMode')).toBe(true);
  });

  it('should return true for formulaEditMode', () => {
    expect(isFormulaEditingContext('formulaEditMode')).toBe(true);
  });

  it('should return true for formulaEditing', () => {
    expect(isFormulaEditingContext('formulaEditing')).toBe(true);
  });

  it('should return false for enterMode', () => {
    expect(isFormulaEditingContext('enterMode')).toBe(false);
  });

  it('should return false for editMode', () => {
    expect(isFormulaEditingContext('editMode')).toBe(false);
  });

  it('should return false for grid', () => {
    expect(isFormulaEditingContext('grid')).toBe(false);
  });
});

describe('supportsTypeToEdit', () => {
  it('should return true for grid', () => {
    expect(supportsTypeToEdit('grid')).toBe(true);
  });

  it('should return false for enterMode', () => {
    expect(supportsTypeToEdit('enterMode')).toBe(false);
  });

  it('should return false for editMode', () => {
    expect(supportsTypeToEdit('editMode')).toBe(false);
  });

  it('should return false for dialog', () => {
    expect(supportsTypeToEdit('dialog')).toBe(false);
  });

  it('should return false for objectSelected', () => {
    expect(supportsTypeToEdit('objectSelected')).toBe(false);
  });
});

describe('isBlockingContext', () => {
  it('should return true for dialog', () => {
    expect(isBlockingContext('dialog')).toBe(true);
  });

  it('should return true for menu', () => {
    expect(isBlockingContext('menu')).toBe(true);
  });

  it('should return false for grid', () => {
    expect(isBlockingContext('grid')).toBe(false);
  });

  it('should return false for enterMode', () => {
    expect(isBlockingContext('enterMode')).toBe(false);
  });

  it('should return false for objectSelected', () => {
    expect(isBlockingContext('objectSelected')).toBe(false);
  });
});
