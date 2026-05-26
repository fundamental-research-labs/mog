/**
 * Tests for OPEN_INSERT_FUNCTION_DIALOG action handler.
 *
 * Verifies that:
 * - When not editing, opens Insert Function dialog via UIStore
 * - When editing a formula (value starts with '='), opens Function Arguments dialog instead
 * - When editing a non-formula value, opens Insert Function dialog
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import { OPEN_INSERT_FUNCTION_DIALOG } from '../dialog-handlers';

function createMockDeps(overrides?: { isEditing?: boolean; value?: string }): ActionDependencies {
  const openInsertFunctionDialog = jest.fn();
  const openFunctionArgumentsDialog = jest.fn();

  const deps = {
    accessors: {
      editor: {
        isEditing: () => overrides?.isEditing ?? false,
        getValue: () => overrides?.value ?? '',
      },
    },
    uiStore: {
      getState: () => ({
        openInsertFunctionDialog,
        openFunctionArgumentsDialog,
      }),
    },
  } as unknown as ActionDependencies;

  return deps;
}

function getUIStoreMocks(deps: ActionDependencies) {
  const state = (deps as any).uiStore.getState();
  return {
    openInsertFunctionDialog: state.openInsertFunctionDialog as jest.Mock,
    openFunctionArgumentsDialog: state.openFunctionArgumentsDialog as jest.Mock,
  };
}

describe('OPEN_INSERT_FUNCTION_DIALOG', () => {
  it('should open insert function dialog via UIStore when not editing', () => {
    const deps = createMockDeps({ isEditing: false });
    const mocks = getUIStoreMocks(deps);

    const result = OPEN_INSERT_FUNCTION_DIALOG(deps);

    expect(result.handled).toBe(true);
    expect(mocks.openInsertFunctionDialog).toHaveBeenCalled();
    expect(mocks.openFunctionArgumentsDialog).not.toHaveBeenCalled();
  });

  it('should open function arguments dialog when editing a formula', () => {
    const deps = createMockDeps({ isEditing: true, value: '=SUM(' });
    const mocks = getUIStoreMocks(deps);

    const result = OPEN_INSERT_FUNCTION_DIALOG(deps);

    expect(result.handled).toBe(true);
    expect(mocks.openFunctionArgumentsDialog).toHaveBeenCalled();
    expect(mocks.openInsertFunctionDialog).not.toHaveBeenCalled();
  });

  it('should open insert function dialog when editing a non-formula value', () => {
    const deps = createMockDeps({ isEditing: true, value: 'hello' });
    const mocks = getUIStoreMocks(deps);

    const result = OPEN_INSERT_FUNCTION_DIALOG(deps);

    expect(result.handled).toBe(true);
    expect(mocks.openInsertFunctionDialog).toHaveBeenCalled();
    expect(mocks.openFunctionArgumentsDialog).not.toHaveBeenCalled();
  });
});
