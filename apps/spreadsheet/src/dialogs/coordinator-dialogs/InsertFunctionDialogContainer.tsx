/**
 * InsertFunctionDialogContainer
 *
 * Container component that wires InsertFunctionDialog to the editor state machine.
 * Must be rendered inside SpreadsheetCoordinatorProvider to access coordinator hooks.
 *
 * When a function is selected from the dialog, it's properly inserted into the
 * editor - either starting a new formula edit or appending to an existing one.
 *
 * @see Stream-H-FORMULA-BAR-COMMAND-PALETTE.md
 */

import { useCallback } from 'react';
import { dispatch, useActionDependencies } from '../../internal-api';
import { InsertFunctionDialog } from '../insert/InsertFunctionDialog';

export function InsertFunctionDialogContainer() {
  const deps = useActionDependencies();

  const insertFunction = useCallback(
    (functionName: string) => {
      dispatch('INSERT_FUNCTION', deps, { functionName });
    },
    [deps],
  );

  return <InsertFunctionDialog onInsert={insertFunction} />;
}
