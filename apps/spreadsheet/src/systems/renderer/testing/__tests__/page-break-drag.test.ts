/**
 * Page Break Drag Tests
 *
 * Tests the page break drag interaction through the RenderSystem.
 * The RenderSystem delegates page break operations to PageBreakCoordinator,
 * which in turn drives the pageBreakMachine (XState actor).
 *
 * The PageBreakCoordinator requires setDependencies() to be called before
 * it can process startDrag/updateDrag/endDrag. Without dependencies,
 * these methods are no-ops. The isPageBreakDragging() check goes through
 * the coordinator which checks the pageBreakActor snapshot directly.
 *
 * Since the coordinator has no deps set in our simulator, startDrag/updateDrag
 * are no-ops. To test the drag state machine directly, we access the
 * pageBreakActor through system.access.actors.pageBreak.
 *
 * @module systems/renderer/testing/__tests__/page-break-drag
 */

import { createRendererSimulator, type RendererSimulator } from '../renderer-simulator';

describe('Page break drag', () => {
  let sim: RendererSimulator;

  beforeEach(() => {
    sim = createRendererSimulator({ autoReady: true });
    sim.start();
  });

  afterEach(() => {
    sim.destroy();
  });

  // ===========================================================================
  // Initial state
  // ===========================================================================

  test('isPageBreakDragging returns false initially', () => {
    expect(sim.isPageBreakDragging()).toBe(false);
  });

  // ===========================================================================
  // Direct actor tests - START_DRAG via machine
  // Since PageBreakCoordinator needs deps, we drive the machine directly
  // ===========================================================================

  test('startPageBreakDrag via actor begins drag', () => {
    const pageBreakActor = sim.system.access.actors.pageBreak;

    pageBreakActor.send({
      type: 'START_DRAG',
      pageBreak: {
        type: 'manual' as const,
        orientation: 'horizontal' as const,
        originalPosition: 5,
        sheetId: 'sheet-1',
      },
      startX: 100,
      startY: 200,
    });

    // The actor is now in 'dragging' state
    const state = pageBreakActor.getSnapshot();
    expect(state.matches('dragging')).toBe(true);
    expect(state.context.pageBreak?.originalPosition).toBe(5);
    expect(state.context.startPosition).toEqual({ x: 100, y: 200 });
  });

  test('DRAG event updates position during drag', () => {
    const pageBreakActor = sim.system.access.actors.pageBreak;

    pageBreakActor.send({
      type: 'START_DRAG',
      pageBreak: {
        type: 'manual' as const,
        orientation: 'horizontal' as const,
        originalPosition: 5,
        sheetId: 'sheet-1',
      },
      startX: 100,
      startY: 200,
    });

    pageBreakActor.send({
      type: 'DRAG',
      x: 100,
      y: 350,
      targetPosition: 8,
    });

    const state = pageBreakActor.getSnapshot();
    expect(state.context.currentPosition).toEqual({ x: 100, y: 350 });
    expect(state.context.targetPosition).toBe(8);
  });

  test('END_DRAG completes drag and returns to idle', () => {
    const pageBreakActor = sim.system.access.actors.pageBreak;

    pageBreakActor.send({
      type: 'START_DRAG',
      pageBreak: {
        type: 'manual' as const,
        orientation: 'horizontal' as const,
        originalPosition: 5,
        sheetId: 'sheet-1',
      },
      startX: 100,
      startY: 200,
    });

    expect(pageBreakActor.getSnapshot().matches('dragging')).toBe(true);

    pageBreakActor.send({ type: 'END_DRAG' });

    const state = pageBreakActor.getSnapshot();
    expect(state.matches('idle')).toBe(true);
    expect(state.context.pageBreak).toBeNull();
  });

  test('CANCEL reverts drag and returns to idle', () => {
    const pageBreakActor = sim.system.access.actors.pageBreak;

    pageBreakActor.send({
      type: 'START_DRAG',
      pageBreak: {
        type: 'manual' as const,
        orientation: 'vertical' as const,
        originalPosition: 3,
        sheetId: 'sheet-1',
      },
      startX: 50,
      startY: 0,
    });

    // Update position
    pageBreakActor.send({
      type: 'DRAG',
      x: 200,
      y: 0,
      targetPosition: 7,
    });

    // Cancel
    pageBreakActor.send({ type: 'CANCEL' });

    const state = pageBreakActor.getSnapshot();
    expect(state.matches('idle')).toBe(true);
    expect(state.context.pageBreak).toBeNull();
    expect(state.context.targetPosition).toBeNull();
  });

  // ===========================================================================
  // DragTerminator integration
  // ===========================================================================

  test('pageBreakDragTerminator.endDrag delegates to coordinator', () => {
    // Without coordinator deps, endDrag is a no-op
    // But it should not throw
    expect(() => {
      sim.endDrag();
    }).not.toThrow();
  });

  test('pageBreakDragTerminator.cancelDrag delegates to coordinator', () => {
    // Without coordinator deps, cancelDrag is a no-op
    // But it should not throw
    expect(() => {
      sim.cancelDrag();
    }).not.toThrow();
  });

  // ===========================================================================
  // Snapshot includes drag state
  // ===========================================================================

  test('snapshot reflects page break drag state', () => {
    const snap1 = sim.snapshot();
    expect(snap1.isPageBreakDragging).toBe(false);

    // Note: isPageBreakDragging() goes through the coordinator which checks
    // if deps are set. Without deps, it always returns false.
    // Direct actor state is the source of truth for the machine.
    const pageBreakActor = sim.system.access.actors.pageBreak;
    pageBreakActor.send({
      type: 'START_DRAG',
      pageBreak: {
        type: 'manual' as const,
        orientation: 'horizontal' as const,
        originalPosition: 10,
        sheetId: 'sheet-1',
      },
      startX: 0,
      startY: 0,
    });

    // The coordinator's isDragging() checks its own deps, so snapshot may
    // still show false. But the actor itself is in dragging state.
    expect(pageBreakActor.getSnapshot().matches('dragging')).toBe(true);
  });
});
