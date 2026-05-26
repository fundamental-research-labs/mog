/**
 * useDebouncedValue Hook Tests
 *
 * Tests for the debounce hooks.
 *
 * @see engine/hooks/use-debounced-value.ts
 */

import { jest } from '@jest/globals';

import { act, renderHook } from '@testing-library/react';

import { useDebouncedValue, useDebouncedValueWithOptions } from '../shared/use-debounced-value';

// =============================================================================
// Test Setup
// =============================================================================

// Use fake timers for all tests in this file
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// =============================================================================
// useDebouncedValue Tests
// =============================================================================

describe('useDebouncedValue', () => {
  describe('basic functionality', () => {
    it('returns initial value immediately', () => {
      const { result } = renderHook(() => useDebouncedValue('initial', 300));
      expect(result.current).toBe('initial');
    });

    it('debounces value changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebouncedValue(value, delay),
        { initialProps: { value: 'initial', delay: 300 } },
      );

      expect(result.current).toBe('initial');

      // Update the value
      rerender({ value: 'updated', delay: 300 });

      // Value should not change immediately
      expect(result.current).toBe('initial');

      // Advance time by less than delay
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(result.current).toBe('initial');

      // Advance past the delay
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(result.current).toBe('updated');
    });

    it('resets debounce timer on rapid changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebouncedValue(value, delay),
        { initialProps: { value: 'a', delay: 300 } },
      );

      // Rapid changes
      rerender({ value: 'b', delay: 300 });
      act(() => {
        jest.advanceTimersByTime(100);
      });

      rerender({ value: 'c', delay: 300 });
      act(() => {
        jest.advanceTimersByTime(100);
      });

      rerender({ value: 'd', delay: 300 });
      act(() => {
        jest.advanceTimersByTime(100);
      });

      // Still at initial value since each change resets the timer
      expect(result.current).toBe('a');

      // Wait for full delay after last change
      act(() => {
        jest.advanceTimersByTime(300);
      });

      // Now we should have the final value
      expect(result.current).toBe('d');
    });

    it('uses default delay of 300ms', () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
        initialProps: { value: 'initial' },
      });

      rerender({ value: 'updated' });

      // Wait 299ms - should still be initial
      act(() => {
        jest.advanceTimersByTime(299);
      });
      expect(result.current).toBe('initial');

      // Wait 1 more ms
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(result.current).toBe('updated');
    });

    it('works with different types', () => {
      // Number
      const { result: numberResult, rerender: numberRerender } = renderHook(
        ({ value }) => useDebouncedValue(value, 100),
        { initialProps: { value: 42 } },
      );
      numberRerender({ value: 100 });
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(numberResult.current).toBe(100);

      // Object
      const obj1 = { name: 'test' };
      const obj2 = { name: 'updated' };
      const { result: objectResult, rerender: objectRerender } = renderHook(
        ({ value }) => useDebouncedValue(value, 100),
        { initialProps: { value: obj1 } },
      );
      objectRerender({ value: obj2 });
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(objectResult.current).toBe(obj2);

      // Array
      const arr1 = [1, 2, 3];
      const arr2 = [4, 5, 6];
      const { result: arrayResult, rerender: arrayRerender } = renderHook(
        ({ value }) => useDebouncedValue(value, 100),
        { initialProps: { value: arr1 } },
      );
      arrayRerender({ value: arr2 });
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(arrayResult.current).toBe(arr2);
    });

    it('handles zero delay', () => {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 0), {
        initialProps: { value: 'initial' },
      });

      rerender({ value: 'updated' });

      // Even with 0 delay, we need to advance timers for setTimeout(fn, 0)
      act(() => {
        jest.advanceTimersByTime(0);
      });

      expect(result.current).toBe('updated');
    });
  });

  describe('cleanup', () => {
    it('clears timeout on unmount', () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      const { unmount, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
        initialProps: { value: 'initial' },
      });

      rerender({ value: 'updated' });
      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });
  });
});

// =============================================================================
// useDebouncedValueWithOptions Tests
// =============================================================================

describe('useDebouncedValueWithOptions', () => {
  describe('trailing edge (default)', () => {
    it('behaves like useDebouncedValue by default', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebouncedValueWithOptions(value, 300),
        { initialProps: { value: 'initial' } },
      );

      expect(result.current).toBe('initial');

      rerender({ value: 'updated' });
      expect(result.current).toBe('initial');

      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(result.current).toBe('updated');
    });
  });

  describe('leading edge', () => {
    it('updates immediately on first render when leading is true', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebouncedValueWithOptions(value, 300, { leading: true }),
        { initialProps: { value: 'initial' } },
      );

      // Initial value is set immediately
      expect(result.current).toBe('initial');

      // Change value
      rerender({ value: 'first-update' });

      // Since leading is true and this is after first render,
      // the update should be debounced normally
      expect(result.current).toBe('initial');

      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(result.current).toBe('first-update');
    });

    it('debounces subsequent changes after leading update', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebouncedValueWithOptions(value, 300, { leading: true }),
        { initialProps: { value: 'a' } },
      );

      // First update
      rerender({ value: 'b' });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(result.current).toBe('b');

      // Rapid changes
      rerender({ value: 'c' });
      rerender({ value: 'd' });
      rerender({ value: 'e' });

      // Should still be 'b' until delay passes
      expect(result.current).toBe('b');

      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(result.current).toBe('e');
    });
  });
});
