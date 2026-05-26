/**
 * Focus Stack Tests
 *
 * Tests the focus stack via InputSystem + real focus actor.
 * Verifies focus layer push/pop, shouldGridHandleKeyboard, and snapshot behavior.
 */

import type { FocusActor } from '../../coordination/focus-coordination';
import { InputSystem } from '../../input-system';
import { createMockFocusActor } from '../mock-focus-actor';

describe('Focus Stack', () => {
  let system: InputSystem;
  let focusActor: FocusActor;

  beforeEach(() => {
    system = new InputSystem({} as any);
    system.start();
    focusActor = createMockFocusActor();
    system.setFocusActor(focusActor);
  });

  afterEach(() => {
    system.dispose();
    focusActor.stop();
  });

  it('shouldGridHandleKeyboard returns true initially', () => {
    expect(system.shouldGridHandleKeyboard()).toBe(true);
  });

  it('pushFocusLayer("dialog", "find") -> shouldGridHandleKeyboard returns false', () => {
    system.pushFocusLayer('dialog', 'find');
    expect(system.shouldGridHandleKeyboard()).toBe(false);
  });

  it('popFocusLayer -> shouldGridHandleKeyboard returns true again', () => {
    system.pushFocusLayer('dialog', 'find');
    expect(system.shouldGridHandleKeyboard()).toBe(false);

    system.popFocusLayer();
    expect(system.shouldGridHandleKeyboard()).toBe(true);
  });

  it('push two layers -> pop one -> still false -> pop second -> true', () => {
    system.pushFocusLayer('dialog', 'find');
    system.pushFocusLayer('dialog', 'confirm');

    expect(system.shouldGridHandleKeyboard()).toBe(false);

    system.popFocusLayer();
    expect(system.shouldGridHandleKeyboard()).toBe(false);

    system.popFocusLayer();
    expect(system.shouldGridHandleKeyboard()).toBe(true);
  });

  it('resetFocusToGrid clears all layers', () => {
    system.pushFocusLayer('dialog', 'find');
    system.pushFocusLayer('dialog', 'confirm');

    expect(system.shouldGridHandleKeyboard()).toBe(false);

    system.resetFocusToGrid();
    expect(system.shouldGridHandleKeyboard()).toBe(true);
  });

  it('getFocusSnapshot returns expected structure', () => {
    const snapshot = system.getFocusSnapshot();

    expect(snapshot).toHaveProperty('state');
    expect(snapshot).toHaveProperty('currentLayer');
    expect(snapshot).toHaveProperty('stack');
    expect(snapshot).toHaveProperty('shouldGridHandle');
    expect(snapshot).toHaveProperty('isInOverlay');

    // Initially in grid state
    expect(snapshot.state).toBe('grid');
    expect(snapshot.shouldGridHandle).toBe(true);
    expect(snapshot.isInOverlay).toBe(false);
    expect(snapshot.stack.length).toBe(1);
    expect(snapshot.currentLayer.type).toBe('grid');
  });

  it('getFocusSnapshot reflects pushed layers', () => {
    system.pushFocusLayer('dialog', 'find');

    const snapshot = system.getFocusSnapshot();

    expect(snapshot.state).toBe('dialog');
    expect(snapshot.shouldGridHandle).toBe(false);
    expect(snapshot.isInOverlay).toBe(true);
    expect(snapshot.stack.length).toBe(2);
    expect(snapshot.currentLayer.type).toBe('dialog');
    expect(snapshot.currentLayer.id).toBe('find');
  });
});
