/**
 * Use Insert Function Hook
 *
 * Provides a function to insert a spreadsheet function into the editor.
 * This hook wraps the INSERT_FUNCTION action for convenient use in dialogs.
 *
 * @see Stream-H-FORMULA-BAR-COMMAND-PALETTE.md
 */

import { useCallback } from 'react';

import { dispatch } from '../../actions';
import { useActionDependencies } from '../toolbar/use-action-dependencies';

/**
 * Return type for useInsertFunction hook.
 */
export interface UseInsertFunctionReturn {
  /** Insert a function by name into the editor */
  insertFunction: (functionName: string) => void;
}

/**
 * Hook that provides a function to insert spreadsheet functions.
 *
 * @returns Object containing insertFunction method
 *
 * @example
 * ```tsx
 * const { insertFunction } = useInsertFunction();
 *
 * // Insert SUM function
 * insertFunction('SUM');
 * ```
 */
export function useInsertFunction(): UseInsertFunctionReturn {
  const deps = useActionDependencies();

  const insertFunction = useCallback(
    (functionName: string) => {
      dispatch('INSERT_FUNCTION', deps, { functionName });
    },
    [deps],
  );

  return { insertFunction };
}
