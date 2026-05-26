/**
 * Selection Mode Handler Tests — closer.
 *
 * Locks in the Excel commit-and-continue (Option 1) wiring for Shift+F8.
 * The machine-side transition is covered by
 * `selection-modes.test.ts: additive_mode_second_toggle_commits_pending_and_starts_new`;
 * this file pins the handler-side dispatch contract that drives it.
 *
 * Literal-bug regression scenario:
 * `dev/app-eval/scenarios/selection/shift-f8-add-to-selection.spec.ts`.
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import type { SelectionModes } from '../../../../systems/grid-editing/machines/selection/types';
import { TOGGLE_ADD_TO_SELECTION, TOGGLE_EXTEND_SELECTION_MODE } from '../modes';

interface MockSetup {
  deps: ActionDependencies;
  setMode: jest.Mock;
  commitPending: jest.Mock;
  exitAllModes: jest.Mock;
  getModes: jest.Mock<() => SelectionModes>;
}

function makeMockDeps(modes: SelectionModes): MockSetup {
  const setMode = jest.fn();
  const commitPending = jest.fn();
  const exitAllModes = jest.fn();
  const getModes = jest.fn<() => SelectionModes>(() => modes);

  const deps = {
    accessors: {
      selection: {
        getModes,
      },
    },
    commands: {
      selection: {
        setMode,
        commitPending,
        exitAllModes,
      },
    },
  } as unknown as ActionDependencies;

  return { deps, setMode, commitPending, exitAllModes, getModes };
}

describe('TOGGLE_ADD_TO_SELECTION (Shift+F8)', () => {
  test('first press: enters additive mode via setMode("additive", true)', () => {
    const setup = makeMockDeps({ end: false, extend: false, additive: false });

    const result = TOGGLE_ADD_TO_SELECTION(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.setMode).toHaveBeenCalledTimes(1);
    expect(setup.setMode).toHaveBeenCalledWith('additive', true);
    expect(setup.commitPending).not.toHaveBeenCalled();
  });

  test('second press: commits pending range via commitPending() (Excel commit-and-continue)', () => {
    const setup = makeMockDeps({ end: false, extend: false, additive: true });

    const result = TOGGLE_ADD_TO_SELECTION(setup.deps);

    expect(result.handled).toBe(true);
    // Strict toggle (calling setMode("additive", false)) is the WRONG behavior:
    // the pending range would be flattened, not committed. The fix must dispatch
    // COMMIT_PENDING via commands.selection.commitPending().
    expect(setup.commitPending).toHaveBeenCalledTimes(1);
    expect(setup.setMode).not.toHaveBeenCalled();
  });
});

describe('TOGGLE_EXTEND_SELECTION_MODE (F8)', () => {
  test('first press: enters extend mode via setMode("extend", true)', () => {
    const setup = makeMockDeps({ end: false, extend: false, additive: false });

    const result = TOGGLE_EXTEND_SELECTION_MODE(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.setMode).toHaveBeenCalledTimes(1);
    expect(setup.setMode).toHaveBeenCalledWith('extend', true);
  });

  test('second press: exits extend mode via setMode("extend", false)', () => {
    const setup = makeMockDeps({ end: false, extend: true, additive: false });

    const result = TOGGLE_EXTEND_SELECTION_MODE(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.setMode).toHaveBeenCalledTimes(1);
    expect(setup.setMode).toHaveBeenCalledWith('extend', false);
  });
});
