/**
 * Renderer Lifecycle Tests
 *
 * Tests the full lifecycle state machine of the RenderSystem:
 * unmounted -> waitingForLayout -> initializing -> ready -> switchingSheet -> suspended -> disposing
 *
 * The RenderSystem uses an XState state machine (rendererMachine) for lifecycle management.
 * State transitions happen synchronously via actor.send(), so no flush() is needed
 * for single-system tests.
 *
 * Note: Without setRendererDependencies(), the execution layer doesn't create a
 * real GridRenderer. These tests validate the state machine transitions, not
 * rendering side effects.
 *
 * @module systems/renderer/testing/__tests__/renderer-lifecycle
 */

import { createRendererSimulator, type RendererSimulator } from '../renderer-simulator';

describe('Renderer lifecycle', () => {
  let sim: RendererSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  // ===========================================================================
  // Initial state
  // ===========================================================================

  test('starts in unmounted state', () => {
    sim = createRendererSimulator();
    sim.start();

    expect(sim.lifecycleState()).toBe('unmounted');
  });

  // ===========================================================================
  // Mount transitions
  // ===========================================================================

  test('mount transitions to waitingForLayout state', () => {
    sim = createRendererSimulator();
    sim.start();
    sim.mount();

    expect(sim.lifecycleState()).toBe('waitingForLayout');
  });

  // ===========================================================================
  // Layout ready
  // ===========================================================================

  test('layoutReady advances lifecycle to initializing', () => {
    sim = createRendererSimulator();
    sim.start();
    sim.mount();
    sim.layout(800, 600);

    expect(sim.lifecycleState()).toBe('initializing');
  });

  // ===========================================================================
  // Renderer initialized
  // ===========================================================================

  test('rendererInitialized completes initialization to ready', () => {
    sim = createRendererSimulator();
    sim.start();
    sim.mount();
    sim.layout(800, 600);
    sim.initSheet('sheet-1');

    expect(sim.lifecycleState()).toBe('ready');
  });

  // ===========================================================================
  // Full lifecycle
  // ===========================================================================

  test('full lifecycle: start -> mount -> layout -> init -> ready', () => {
    sim = createRendererSimulator();

    // Track states through lifecycle
    const states: string[] = [];

    sim.start();
    states.push(sim.lifecycleState());

    sim.mount();
    states.push(sim.lifecycleState());

    sim.layout(1024, 768);
    states.push(sim.lifecycleState());

    sim.initSheet('sheet-1');
    states.push(sim.lifecycleState());

    expect(states).toEqual(['unmounted', 'waitingForLayout', 'initializing', 'ready']);
  });

  // ===========================================================================
  // autoReady
  // ===========================================================================

  test('autoReady advances to ready state automatically', () => {
    sim = createRendererSimulator({ autoReady: true });
    sim.start();

    expect(sim.lifecycleState()).toBe('ready');
  });

  // ===========================================================================
  // Sheet switching
  // ===========================================================================

  test('switchSheet from ready state', () => {
    sim = createRendererSimulator({ autoReady: true });
    sim.start();

    sim.switchSheet('sheet-2');

    // Without rendererExecution.setDependencies() wired, the switch won't
    // auto-complete (SHEET_SWITCHED is sent by execution layer). The machine
    // stays in switchingSheet until the execution layer signals completion.
    expect(sim.lifecycleState()).toBe('switchingSheet');
    expect(sim.snapshot().isSwitching).toBe(true);
  });

  // ===========================================================================
  // Suspend / Resume
  // ===========================================================================

  test('suspend pauses the system', () => {
    sim = createRendererSimulator({ autoReady: true });
    sim.start();

    sim.suspend();

    expect(sim.lifecycleState()).toBe('suspended');
  });

  test('resume from suspended state returns to ready', () => {
    sim = createRendererSimulator({ autoReady: true });
    sim.start();

    sim.suspend();
    expect(sim.lifecycleState()).toBe('suspended');

    sim.resume();
    expect(sim.lifecycleState()).toBe('ready');
  });

  // ===========================================================================
  // Resize
  // ===========================================================================

  test('resize updates dimensions while in ready state', () => {
    sim = createRendererSimulator({ autoReady: true });
    sim.start();

    // Resize should not change the lifecycle state - stays in ready
    sim.resize(1200, 900);

    expect(sim.lifecycleState()).toBe('ready');
  });

  // ===========================================================================
  // Dispose
  // ===========================================================================

  test('dispose from ready state is safe', () => {
    sim = createRendererSimulator({ autoReady: true });
    sim.start();

    expect(sim.lifecycleState()).toBe('ready');

    sim.destroy();

    // After dispose, the renderer snapshot shows 'unmounted' because the
    // disposing state has an `always` transition to unmounted.
    // Accessing getRendererSnapshot after dispose may show 'unmounted'.
    // The important thing is that dispose doesn't throw.
    // Re-create to avoid double-destroy in afterEach
    sim = createRendererSimulator();
  });

  test('dispose from unmounted state is safe', () => {
    sim = createRendererSimulator();
    sim.start();

    expect(sim.lifecycleState()).toBe('unmounted');

    // Should not throw
    sim.destroy();

    // Re-create for afterEach
    sim = createRendererSimulator();
  });

  test('dispose from suspended state is safe', () => {
    sim = createRendererSimulator({ autoReady: true });
    sim.start();
    sim.suspend();

    expect(sim.lifecycleState()).toBe('suspended');

    sim.destroy();

    // Re-create for afterEach
    sim = createRendererSimulator();
  });

  // ===========================================================================
  // Idempotency
  // ===========================================================================

  test('double-start is idempotent', () => {
    sim = createRendererSimulator();
    sim.start();

    // Second start should be a no-op (RenderSystem checks this.started)
    sim.start();

    expect(sim.lifecycleState()).toBe('unmounted');
  });

  // ===========================================================================
  // onReady callback
  // ===========================================================================

  test('onReady fires when reaching ready state', () => {
    sim = createRendererSimulator();
    sim.start();

    let readyCalled = false;
    sim.system.onReady(() => {
      readyCalled = true;
    });

    expect(readyCalled).toBe(false);

    sim.mount();
    sim.layout(800, 600);
    sim.initSheet('sheet-1');

    expect(readyCalled).toBe(true);
  });

  test('onReady fires immediately if already ready', () => {
    sim = createRendererSimulator({ autoReady: true });
    sim.start();

    let readyCalled = false;
    sim.system.onReady(() => {
      readyCalled = true;
    });

    expect(readyCalled).toBe(true);
  });

  // ===========================================================================
  // Operations before start are no-ops
  // ===========================================================================

  test('mount before start is a no-op', () => {
    sim = createRendererSimulator();
    // Don't call start()

    // mount should silently return because started === false
    sim.mount();

    // After starting, should still be unmounted (mount was ignored)
    sim.start();
    expect(sim.lifecycleState()).toBe('unmounted');
  });
});
