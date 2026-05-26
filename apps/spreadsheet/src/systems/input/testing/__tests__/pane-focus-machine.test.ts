/**
 * Pane Focus Machine - Pure State Machine Tests
 *
 * Tests the pane focus machine in isolation using createActor from xstate.
 * No DOM, no coordinators, no side effects.
 *
 * The machine manages F6 pane navigation cycling between:
 * toolbar -> formulaBar -> grid -> statusBar (and back)
 */

import { createActor } from 'xstate';

import { PaneFocusEvents, paneFocusMachine } from '../../machines/pane-focus-machine';

function createPaneFocusActor() {
  const actor = createActor(paneFocusMachine);
  actor.start();
  return actor;
}

describe('paneFocusMachine', () => {
  it('starts in grid state', () => {
    const actor = createPaneFocusActor();
    const snapshot = actor.getSnapshot();

    expect(snapshot.value).toBe('grid');
    expect(snapshot.context.currentPane).toBe('grid');
    expect(snapshot.context.previousPane).toBeNull();

    actor.stop();
  });

  it('FOCUS_NEXT_PANE cycles: grid -> statusBar -> toolbar -> formulaBar -> grid', () => {
    const actor = createPaneFocusActor();

    // grid -> statusBar
    actor.send(PaneFocusEvents.focusNextPane());
    expect(actor.getSnapshot().value).toBe('statusBar');

    // statusBar -> toolbar
    actor.send(PaneFocusEvents.focusNextPane());
    expect(actor.getSnapshot().value).toBe('toolbar');

    // toolbar -> formulaBar
    actor.send(PaneFocusEvents.focusNextPane());
    expect(actor.getSnapshot().value).toBe('formulaBar');

    // formulaBar -> grid (full cycle)
    actor.send(PaneFocusEvents.focusNextPane());
    expect(actor.getSnapshot().value).toBe('grid');

    actor.stop();
  });

  it('FOCUS_PREVIOUS_PANE cycles: grid -> formulaBar -> toolbar -> statusBar -> grid', () => {
    const actor = createPaneFocusActor();

    // grid -> formulaBar
    actor.send(PaneFocusEvents.focusPreviousPane());
    expect(actor.getSnapshot().value).toBe('formulaBar');

    // formulaBar -> toolbar
    actor.send(PaneFocusEvents.focusPreviousPane());
    expect(actor.getSnapshot().value).toBe('toolbar');

    // toolbar -> statusBar
    actor.send(PaneFocusEvents.focusPreviousPane());
    expect(actor.getSnapshot().value).toBe('statusBar');

    // statusBar -> grid (full cycle)
    actor.send(PaneFocusEvents.focusPreviousPane());
    expect(actor.getSnapshot().value).toBe('grid');

    actor.stop();
  });

  it('FOCUS_PANE jumps to specific pane', () => {
    const actor = createPaneFocusActor();

    // grid -> toolbar
    actor.send(PaneFocusEvents.focusPane('toolbar'));
    expect(actor.getSnapshot().value).toBe('toolbar');

    // toolbar -> statusBar
    actor.send(PaneFocusEvents.focusPane('statusBar'));
    expect(actor.getSnapshot().value).toBe('statusBar');

    // statusBar -> formulaBar
    actor.send(PaneFocusEvents.focusPane('formulaBar'));
    expect(actor.getSnapshot().value).toBe('formulaBar');

    // formulaBar -> grid
    actor.send(PaneFocusEvents.focusPane('grid'));
    expect(actor.getSnapshot().value).toBe('grid');

    actor.stop();
  });

  it('RESET_TO_GRID returns to grid from any state', () => {
    const actor = createPaneFocusActor();

    // From toolbar
    actor.send(PaneFocusEvents.focusPane('toolbar'));
    expect(actor.getSnapshot().value).toBe('toolbar');
    actor.send(PaneFocusEvents.resetToGrid());
    expect(actor.getSnapshot().value).toBe('grid');

    // From formulaBar
    actor.send(PaneFocusEvents.focusPane('formulaBar'));
    expect(actor.getSnapshot().value).toBe('formulaBar');
    actor.send(PaneFocusEvents.resetToGrid());
    expect(actor.getSnapshot().value).toBe('grid');

    // From statusBar
    actor.send(PaneFocusEvents.focusPane('statusBar'));
    expect(actor.getSnapshot().value).toBe('statusBar');
    actor.send(PaneFocusEvents.resetToGrid());
    expect(actor.getSnapshot().value).toBe('grid');

    // From grid (no-op, stays in grid)
    actor.send(PaneFocusEvents.resetToGrid());
    expect(actor.getSnapshot().value).toBe('grid');

    actor.stop();
  });

  it('tracks previousPane on FOCUS_NEXT_PANE transitions', () => {
    const actor = createPaneFocusActor();

    // Initial: previousPane is null
    expect(actor.getSnapshot().context.previousPane).toBeNull();

    // grid -> statusBar: previousPane should be grid
    actor.send(PaneFocusEvents.focusNextPane());
    expect(actor.getSnapshot().context.currentPane).toBe('statusBar');
    expect(actor.getSnapshot().context.previousPane).toBe('grid');

    // statusBar -> toolbar: previousPane should be statusBar
    actor.send(PaneFocusEvents.focusNextPane());
    expect(actor.getSnapshot().context.currentPane).toBe('toolbar');
    expect(actor.getSnapshot().context.previousPane).toBe('statusBar');

    actor.stop();
  });

  it('tracks previousPane on FOCUS_PREVIOUS_PANE transitions', () => {
    const actor = createPaneFocusActor();

    // grid -> formulaBar: previousPane should be grid
    actor.send(PaneFocusEvents.focusPreviousPane());
    expect(actor.getSnapshot().context.currentPane).toBe('formulaBar');
    expect(actor.getSnapshot().context.previousPane).toBe('grid');

    // formulaBar -> toolbar: previousPane should be formulaBar
    actor.send(PaneFocusEvents.focusPreviousPane());
    expect(actor.getSnapshot().context.currentPane).toBe('toolbar');
    expect(actor.getSnapshot().context.previousPane).toBe('formulaBar');

    actor.stop();
  });

  it('tracks previousPane on RESET_TO_GRID', () => {
    const actor = createPaneFocusActor();

    // Navigate to toolbar via FOCUS_NEXT_PANE twice (grid -> statusBar -> toolbar)
    actor.send(PaneFocusEvents.focusNextPane());
    actor.send(PaneFocusEvents.focusNextPane());
    expect(actor.getSnapshot().context.currentPane).toBe('toolbar');

    // RESET_TO_GRID: previousPane should be toolbar
    actor.send(PaneFocusEvents.resetToGrid());
    expect(actor.getSnapshot().context.currentPane).toBe('grid');
    expect(actor.getSnapshot().context.previousPane).toBe('toolbar');

    actor.stop();
  });
});
