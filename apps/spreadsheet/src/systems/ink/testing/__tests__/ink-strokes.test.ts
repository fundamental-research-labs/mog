/**
 * Ink Stroke Tests
 * Tests stroke recording, eraser mode, and drag terminator behavior.
 *
 * @module systems/ink/testing/__tests__
 */

import { createInkSimulator } from '../ink-simulator';

describe('Ink strokes', () => {
  // ==========================================================================
  // STROKE EVENTS WHILE INACTIVE
  // ==========================================================================

  test('stroke while inactive is ignored (state stays idle)', () => {
    const sim = createInkSimulator();
    sim.start();

    // Not activated -- pen events should be ignored by the machine
    // (idle state has no PEN_DOWN transition)
    sim.startStroke(10, 20);
    expect(sim.actorState()).toBe('idle');
    expect(sim.isActive()).toBe(false);

    sim.destroy();
  });

  // ==========================================================================
  // STROKE SEQUENCE
  // ==========================================================================

  test('start/continue/end stroke sequence', () => {
    const sim = createInkSimulator();
    sim.start();
    sim.activate('drawing-1');

    expect(sim.actorState()).toBe('drawing');

    // Start stroke
    sim.startStroke(10, 20, 0.5);
    expect(sim.actorState()).toBe('stroking');

    // Verify the actor context has stroke data
    const accessor = sim.system.access.accessors.ink;
    expect(accessor.isStroking()).toBe(true);
    expect(accessor.getCurrentStrokeLength()).toBe(1);

    // Continue stroke
    sim.continueStroke(20, 30, 0.6);
    expect(sim.actorState()).toBe('stroking');
    expect(accessor.getCurrentStrokeLength()).toBe(2);

    sim.continueStroke(30, 40, 0.7);
    expect(accessor.getCurrentStrokeLength()).toBe(3);

    // End stroke
    sim.endStroke();
    expect(sim.actorState()).toBe('drawing');
    expect(accessor.isStroking()).toBe(false);

    sim.destroy();
  });

  test('multiple sequential strokes', () => {
    const sim = createInkSimulator();
    sim.start();
    sim.activate('drawing-1');

    // First stroke
    sim.startStroke(0, 0);
    sim.continueStroke(10, 10);
    sim.endStroke();
    expect(sim.actorState()).toBe('drawing');

    // Second stroke -- should work fine
    sim.startStroke(50, 50);
    sim.continueStroke(60, 60);
    sim.endStroke();
    expect(sim.actorState()).toBe('drawing');

    sim.destroy();
  });

  // ==========================================================================
  // DRAG TERMINATOR
  // ==========================================================================

  test('dragTerminator.endDrag completes active stroke', () => {
    const sim = createInkSimulator();
    sim.start();
    sim.activate('drawing-1');

    // Start a stroke
    sim.startStroke(10, 20);
    expect(sim.actorState()).toBe('stroking');

    // EndDrag should send PEN_UP, completing the stroke
    sim.endDrag();
    expect(sim.actorState()).toBe('drawing');
    expect(sim.isActive()).toBe(true);

    sim.destroy();
  });

  test('dragTerminator.cancelDrag cancels active stroke', () => {
    const sim = createInkSimulator();
    sim.start();
    sim.activate('drawing-1');

    // Start a stroke
    sim.startStroke(10, 20);
    sim.continueStroke(20, 30);
    expect(sim.actorState()).toBe('stroking');

    // CancelDrag should deactivate then re-activate (cancel the stroke, not the mode)
    sim.cancelDrag();

    // After cancel: should be back in drawing state (re-activated with same drawingId)
    expect(sim.actorState()).toBe('drawing');
    expect(sim.isActive()).toBe(true);

    sim.destroy();
  });

  test('dragTerminator.endDrag while idle is a no-op', () => {
    const sim = createInkSimulator();
    sim.start();

    // Not active -- endDrag should not throw
    expect(() => sim.endDrag()).not.toThrow();
    expect(sim.actorState()).toBe('idle');

    sim.destroy();
  });

  test('dragTerminator.endDrag while in drawing (not stroking) is a no-op', () => {
    const sim = createInkSimulator();
    sim.start();
    sim.activate('drawing-1');

    expect(sim.actorState()).toBe('drawing');

    // endDrag while in drawing but not stroking should be safe
    expect(() => sim.endDrag()).not.toThrow();
    expect(sim.actorState()).toBe('drawing');

    sim.destroy();
  });

  // ==========================================================================
  // ERASER MODE
  // ==========================================================================

  test('eraser mode: start/continue/end erase sequence', () => {
    const sim = createInkSimulator();
    sim.start();
    sim.activate('drawing-1');

    expect(sim.actorState()).toBe('drawing');

    // Start erase
    sim.startErase(10, 20);
    expect(sim.actorState()).toBe('erasingActive');

    const accessor = sim.system.access.accessors.ink;
    expect(accessor.isErasing()).toBe(true);

    // Continue erase
    sim.continueErase(20, 30);
    expect(sim.actorState()).toBe('erasingActive');

    // End erase
    sim.endErase();
    expect(sim.actorState()).toBe('drawing');
    expect(accessor.isErasing()).toBe(false);

    sim.destroy();
  });

  test('dragTerminator.endDrag completes active erase', () => {
    const sim = createInkSimulator();
    sim.start();
    sim.activate('drawing-1');

    sim.startErase(10, 20);
    expect(sim.actorState()).toBe('erasingActive');

    // EndDrag should send ERASER_UP
    sim.endDrag();
    expect(sim.actorState()).toBe('drawing');

    sim.destroy();
  });

  // ==========================================================================
  // DEACTIVATE DURING INTERACTION
  // ==========================================================================

  test('deactivate during stroking returns to idle', () => {
    const sim = createInkSimulator();
    sim.start();
    sim.activate('drawing-1');

    sim.startStroke(10, 20);
    expect(sim.actorState()).toBe('stroking');

    // Deactivating while stroking should cancel the stroke and go to idle
    sim.deactivate();
    expect(sim.actorState()).toBe('idle');
    expect(sim.isActive()).toBe(false);

    sim.destroy();
  });

  test('deactivate during erasing returns to idle', () => {
    const sim = createInkSimulator();
    sim.start();
    sim.activate('drawing-1');

    sim.startErase(10, 20);
    expect(sim.actorState()).toBe('erasingActive');

    sim.deactivate();
    expect(sim.actorState()).toBe('idle');
    expect(sim.isActive()).toBe(false);

    sim.destroy();
  });

  // ==========================================================================
  // STROKE WITH PRESSURE
  // ==========================================================================

  test('stroke captures pressure data', () => {
    const sim = createInkSimulator();
    sim.start();
    sim.activate('drawing-1');

    sim.startStroke(10, 20, 0.5);
    sim.continueStroke(20, 30, 0.8);
    sim.continueStroke(30, 40, 1.0);

    // Verify points were captured via accessor
    const accessor = sim.system.access.accessors.ink;
    expect(accessor.getCurrentStrokeLength()).toBe(3);

    // Get the stroke copy and check pressure values
    const stroke = accessor.getCurrentStroke();
    expect(stroke[0]).toEqual({ x: 10, y: 20, pressure: 0.5 });
    expect(stroke[1]).toEqual({ x: 20, y: 30, pressure: 0.8 });
    expect(stroke[2]).toEqual({ x: 30, y: 40, pressure: 1.0 });

    sim.endStroke();
    sim.destroy();
  });
});
