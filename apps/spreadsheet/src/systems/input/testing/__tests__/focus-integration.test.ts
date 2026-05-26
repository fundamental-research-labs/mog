/**
 * Focus Integration Tests
 * Tests focus wiring end-to-end through InputSystem with a real focus actor.
 */

import { createActor } from 'xstate';

import { focusMachine } from '@mog/shell';

import { InputSystem } from '../../input-system';

describe('Focus integration', () => {
  let system: InputSystem;

  beforeEach(() => {
    system = new InputSystem({} as any);
    system.start();
    const focusActor = createActor(focusMachine);
    focusActor.start();
    system.setFocusActor(focusActor);
  });

  afterEach(() => {
    system.dispose();
  });

  it('shouldGridHandleKeyboard returns true by default', () => {
    expect(system.shouldGridHandleKeyboard()).toBe(true);
  });

  it('pushing dialog layer gates keyboard from grid', () => {
    system.pushFocusLayer('dialog', 'find');
    expect(system.shouldGridHandleKeyboard()).toBe(false);
  });

  it('popping dialog layer restores keyboard to grid', () => {
    system.pushFocusLayer('dialog', 'find');
    expect(system.shouldGridHandleKeyboard()).toBe(false);
    system.popFocusLayer();
    expect(system.shouldGridHandleKeyboard()).toBe(true);
  });

  it('resetFocusToGrid clears all layers', () => {
    system.pushFocusLayer('dialog', 'find');
    system.pushFocusLayer('dialog', 'replace');
    expect(system.shouldGridHandleKeyboard()).toBe(false);
    system.resetFocusToGrid();
    expect(system.shouldGridHandleKeyboard()).toBe(true);
  });

  it('getFocusSnapshot returns valid snapshot', () => {
    const snapshot = system.getFocusSnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot.state).toBe('grid');
    expect(snapshot.shouldGridHandle).toBe(true);
  });

  it('getFocusSnapshot reflects dialog layer', () => {
    system.pushFocusLayer('dialog', 'find');
    const snapshot = system.getFocusSnapshot();
    expect(snapshot.shouldGridHandle).toBe(false);
    expect(snapshot.isInOverlay).toBe(true);
  });
});
