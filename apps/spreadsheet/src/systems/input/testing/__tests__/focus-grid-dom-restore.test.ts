/**
 * Focus Grid DOM Restore Regression Test
 *
 * Verifies that `focusGrid()` drives DOM focus back to the registered
 * grid container even when the focus stack is already at length 1.
 *
 * Background: chrome inputs (Name Box Enter, formula bar return,
 * sheet-tab edit-end) reach `focusGrid()` while the focus stack is
 * already at length 1, so the subscriber's stack-shrink branch (which
 * fires only on N→1 transitions) is skipped. Before the fix, DOM focus
 * stayed on `<body>`, so subsequent printable keystrokes never reached
 * the grid div's React `onKeyDown` and the type-to-edit fallback never
 * triggered. After the fix, `focusGrid()` calls
 * `gridContainer.focus()` inside `requestAnimationFrame` when the grid layer
 * still owns focus.
 */

import { createActor } from 'xstate';

import { focusMachine } from '@mog/shell';

import { InputSystem } from '../../input-system';

// Wait for the rAF that focusGrid() schedules.
async function flushRaf(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('focusGrid DOM restore', () => {
  let system: InputSystem;
  let gridContainer: HTMLDivElement;

  beforeEach(() => {
    system = new InputSystem({} as any);
    system.start();
    const focusActor = createActor(focusMachine);
    focusActor.start();
    system.setFocusActor(focusActor);

    // A focusable element to stand in for the grid container div. We need
    // tabIndex so jsdom will let it receive programmatic focus.
    gridContainer = document.createElement('div');
    gridContainer.tabIndex = -1;
    gridContainer.setAttribute('data-test-grid', 'true');
    document.body.appendChild(gridContainer);
  });

  afterEach(() => {
    system.dispose();
    document.body.removeChild(gridContainer);
  });

  it('moves DOM focus from <body> to the grid container with stack at length 1', async () => {
    system.setGridContainer(gridContainer);

    // Sanity: nothing has been focused yet, so activeElement is the body.
    expect(document.activeElement).toBe(document.body);
    // Stack starts at length 1 (just the base grid layer).
    expect(system.getFocusSnapshot().stack.length).toBe(1);

    system.focusGrid();
    await flushRaf();

    expect(document.activeElement).toBe(gridContainer);
  });

  it('is a no-op on DOM (and does not throw) when no grid container is registered', async () => {
    // Note: setGridContainer is intentionally NOT called here.
    expect(document.activeElement).toBe(document.body);

    expect(() => system.focusGrid()).not.toThrow();
    await flushRaf();

    // Still on body — no container to focus.
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves focus state at "grid" with shouldGridHandle === true after focusGrid()', async () => {
    system.setGridContainer(gridContainer);

    system.focusGrid();
    await flushRaf();

    const snapshot = system.getFocusSnapshot();
    expect(snapshot.state).toBe('grid');
    expect(snapshot.shouldGridHandle).toBe(true);
  });

  it('does not steal focus from a newer editor layer before the scheduled grid focus runs', async () => {
    system.setGridContainer(gridContainer);
    const editor = document.createElement('textarea');
    editor.setAttribute('data-testid', 'inline-cell-editor');
    document.body.appendChild(editor);

    try {
      system.focusGrid();
      system.focusEditor();
      editor.focus();
      await flushRaf();

      expect(system.getFocusSnapshot().state).toBe('editor');
      expect(document.activeElement).toBe(editor);
    } finally {
      document.body.removeChild(editor);
    }
  });
});
