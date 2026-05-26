/**
 * useDebouncedValue Hook
 *
 * A React hook that debounces a value, returning the debounced version.
 * Useful for expensive computations or API calls triggered by rapidly changing values.
 *
 * @module engine/hooks/use-debounced-value
 */

import { useEffect, useState } from 'react';

/**
 * Returns a debounced version of the provided value.
 *
 * The returned value will only update after the specified delay has passed
 * without the input value changing.
 *
 * @param value - The value to debounce
 * @param delay - The debounce delay in milliseconds (default: 300ms)
 * @returns The debounced value
 *
 * @example
 * ```tsx
 * function SearchInput() {
 * const [searchTerm, setSearchTerm] = useState('');
 * const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
 *
 * // API call only happens when debouncedSearchTerm changes
 * useEffect( => {
 * if (debouncedSearchTerm) {
 * fetchResults(debouncedSearchTerm);
 * }
 * }, [debouncedSearchTerm]);
 *
 * return <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />;
 * }
 * ```
 */
export function useDebouncedValue<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Set up the timeout to update debounced value
    const timeoutId = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Clear timeout if value changes or component unmounts
    return () => {
      clearTimeout(timeoutId);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Returns a debounced version of the provided value, with immediate option.
 *
 * Similar to useDebouncedValue but with an option to immediately update
 * on the first call (leading edge debounce).
 *
 * @param value - The value to debounce
 * @param delay - The debounce delay in milliseconds (default: 300ms)
 * @param options - Debounce options
 * @returns The debounced value
 */
export function useDebouncedValueWithOptions<T>(
  value: T,
  delay: number = 300,
  options: { leading?: boolean } = {},
): T {
  const { leading = false } = options;
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const [isFirstRender, setIsFirstRender] = useState(true);

  useEffect(() => {
    // If leading is true and this is the first render, update immediately
    if (leading && isFirstRender) {
      setDebouncedValue(value);
      setIsFirstRender(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [value, delay, leading, isFirstRender]);

  return debouncedValue;
}
