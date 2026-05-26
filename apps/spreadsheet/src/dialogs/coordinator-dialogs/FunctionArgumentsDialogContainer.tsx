/**
 * FunctionArgumentsDialogContainer
 *
 * Container component that wires FunctionArgumentsDialog to the editor state machine.
 * Must be rendered inside SpreadsheetCoordinatorProvider to access coordinator hooks.
 *
 * When arguments are edited and OK is clicked, the formula is updated in the editor.
 *
 */

import { useCallback } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';
import { FunctionArgumentsDialog } from '../insert/FunctionArgumentsDialog';

export function FunctionArgumentsDialogContainer() {
  const deps = useActionDependencies();
  const isFunctionArgumentsDialogOpen = useUIStore((s) => s.functionArgumentsDialogOpen);

  const insertFunction = useCallback(
    (functionName: string) => {
      dispatch('INSERT_FUNCTION', deps, { functionName });
    },
    [deps],
  );

  return <FunctionArgumentsDialog open={isFunctionArgumentsDialogOpen} onInsert={insertFunction} />;
}
