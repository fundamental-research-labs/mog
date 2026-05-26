/**
 * Focus Stack — Backstage push/pop regression test .
 *
 * The capture-phase Escape listener that BackstageView used to register
 * (commit `83982d719`) papered over a missing focus layer: the focus
 * machine had no record of backstage being open, so any future feature
 * gating on `focus.current` would silently misbehave when backstage was
 * the active modal.
 *
 * #7 replaces the capture-phase race with a `dialog`-typed
 * focus-layer push (`{ type: 'dialog', id: 'backstage' }`) on
 * `backstage.isOpen` true; pop on close. The grid's keyboard handler
 * already returns when `shouldGridHandleKeyboard()` is false (see
 * `use-grid-keyboard.ts:156`), so the bubble-phase Escape listener in
 * BackstageView is sufficient to close the panel without racing the grid.
 *
 * This test locks the contract at the focus-machine layer:
 * - pushing the backstage layer disqualifies the grid from keyboard
 * - the dialog state matches `'dialog'`, so any `focus.current.type ===
 * 'dialog'` consumer treats backstage uniformly with other dialogs
 * - popping restores grid handling
 */

import type { FocusActor } from '../../coordination/focus-coordination';
import { InputSystem } from '../../input-system';
import { createMockFocusActor } from '../mock-focus-actor';

describe('Focus Stack — Backstage layer', () => {
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

  it('push dialog/backstage disqualifies the grid from keyboard handling', () => {
    expect(system.shouldGridHandleKeyboard()).toBe(true);

    system.pushFocusLayer('dialog', 'backstage');
    expect(system.shouldGridHandleKeyboard()).toBe(false);
  });

  it('backstage push reports state="dialog" so generic dialog consumers see it', () => {
    system.pushFocusLayer('dialog', 'backstage');

    const snapshot = system.getFocusSnapshot();
    expect(snapshot.state).toBe('dialog');
    expect(snapshot.currentLayer.type).toBe('dialog');
    expect(snapshot.currentLayer.id).toBe('backstage');
    expect(snapshot.shouldGridHandle).toBe(false);
  });

  it('pop restores grid handling', () => {
    system.pushFocusLayer('dialog', 'backstage');
    expect(system.shouldGridHandleKeyboard()).toBe(false);

    system.popFocusLayer();
    expect(system.shouldGridHandleKeyboard()).toBe(true);
    expect(system.getFocusSnapshot().state).toBe('grid');
  });

  it('backstage layer composes with subsequent dialog pushes (e.g. nested confirm)', () => {
    system.pushFocusLayer('dialog', 'backstage');
    system.pushFocusLayer('dialog', 'confirm-discard');

    expect(system.shouldGridHandleKeyboard()).toBe(false);
    // Top of stack is the inner dialog
    expect(system.getFocusSnapshot().currentLayer.id).toBe('confirm-discard');

    // Pop inner — backstage still active
    system.popFocusLayer();
    expect(system.shouldGridHandleKeyboard()).toBe(false);
    expect(system.getFocusSnapshot().currentLayer.id).toBe('backstage');

    // Pop backstage — grid restored
    system.popFocusLayer();
    expect(system.shouldGridHandleKeyboard()).toBe(true);
  });
});
