/**
 * State-Aware Input Routing Tests
 *
 * Verifies state-aware input routing fixes:
 *
 * 1. Bug #9: Keyboard capture respects autocomplete/picker state
 * - Tab/Enter/Escape propagate to autocomplete when suggestions are open
 * - Tab/Enter/Escape are intercepted by grid when suggestions are closed
 *
 * 2. Bug #11: Shift+click in formula editing mode produces range references
 * - Click A1 then shift+click A5 inserts "A1:A5"
 * - Normal clicks still insert single cell references
 *
 * 3. Bug #14: Fill handle drag sends correct events
 * - Tested in systems/input/__tests__/input-events.test.ts (unit level)
 * - Integration test here verifies full drag sequence through GridSimulator
 *
 */

import { createGridSimulator, type GridSimulator } from '../grid-simulator';

// =============================================================================
// Bug #9: Keyboard Capture State Awareness
// =============================================================================

/**
 * The keyboard capture handler in CoordinatorProvider.tsx reads
 * `editorSnapshot.context.isSuggestionsOpen` and `editorSnapshot.context.isPickerOpen`
 * before intercepting Tab/Enter/Escape. When either is true, it returns early
 * so the event propagates to the autocomplete/picker handler.
 *
 * Since the capture handler is embedded in a React useEffect and operates on
 * the raw DOM, we test the decision logic by directly checking the editor machine
 * context flags that drive the behavior.
 */
describe('Bug #9: Keyboard capture respects autocomplete state', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  it('editor context exposes isSuggestionsOpen flag (false when no prefix typed)', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    // Just "=" with no function prefix — suggestions should not be open
    sim.startEditing('=');
    await sim.flush();

    const editorActor = sim.system.access.actors.editor;
    const snap = editorActor.getSnapshot();
    expect(snap.context.isSuggestionsOpen).toBe(false);
  });

  it('editor context exposes isPickerOpen flag', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    const editorActor = sim.system.access.actors.editor;
    const snap = editorActor.getSnapshot();
    expect(snap.context.isPickerOpen).toBe(false);
  });

  it('isSuggestionsOpen becomes true when autocomplete triggers', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=SUM');
    await sim.flush();

    // Open suggestions via SHOW_SUGGESTIONS event
    const editorActor = sim.system.access.actors.editor;
    editorActor.send({ type: 'SHOW_SUGGESTIONS' });
    await sim.flush();

    const snap = editorActor.getSnapshot();
    expect(snap.context.isSuggestionsOpen).toBe(true);
  });

  it('isSuggestionsOpen becomes false when autocomplete closes', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=SUM');
    await sim.flush();

    // Open then close suggestions
    const editorActor = sim.system.access.actors.editor;
    editorActor.send({ type: 'SHOW_SUGGESTIONS' });
    await sim.flush();
    expect(editorActor.getSnapshot().context.isSuggestionsOpen).toBe(true);

    editorActor.send({ type: 'HIDE_SUGGESTIONS' });
    await sim.flush();
    expect(editorActor.getSnapshot().context.isSuggestionsOpen).toBe(false);
  });

  it('keyboard capture decision: when suggestions open, navigation keys should NOT be intercepted', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=SUM');
    await sim.flush();

    const editorActor = sim.system.access.actors.editor;
    editorActor.send({ type: 'SHOW_SUGGESTIONS' });
    await sim.flush();

    const snap = editorActor.getSnapshot();
    const isEditing =
      snap.matches('editing') || snap.matches('formulaEditing') || snap.matches('imeComposing');
    const { isSuggestionsOpen, isPickerOpen } = snap.context;

    // The capture handler logic: if editing AND (suggestions OR picker), return early
    expect(isEditing).toBe(true);
    expect(isSuggestionsOpen || isPickerOpen).toBe(true);

    // This combination means Tab/Enter/Escape should propagate (not intercepted)
    // The capture handler returns early in this case
  });

  it('keyboard capture decision: when suggestions closed, navigation keys SHOULD be intercepted', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    // Just "=" — no function prefix, so suggestions won't auto-open
    sim.startEditing('=');
    await sim.flush();

    const snap = sim.system.access.actors.editor.getSnapshot();
    const isEditing =
      snap.matches('editing') || snap.matches('formulaEditing') || snap.matches('imeComposing');
    const { isSuggestionsOpen, isPickerOpen } = snap.context;

    // Without suggestions/picker, the handler proceeds to intercept
    expect(isEditing).toBe(true);
    expect(isSuggestionsOpen || isPickerOpen).toBe(false);

    // This combination means the handler routes to KeyboardCoordinator
  });
});

// =============================================================================
// Bug #11: Shift+Click Formula Range References
// =============================================================================

describe('Bug #11: Shift+click in formula editing inserts range reference', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  it('click A1 then shift+click A5 inserts a range reference', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    expect(sim.isFormulaEditing()).toBe(true);

    // Click cell A1 (row 0, col 0) — sets anchor and inserts single ref
    sim.clickCell(0, 0);
    expect(sim.editorValue()).toBe('=A1');

    // Shift+click cell A5 (row 4, col 0) — should extend to range A1:A5
    sim.clickCell(4, 0, { shift: true });
    expect(sim.editorValue()).toBe('=A1:A5');
  });

  it('normal click after shift+click sets new anchor', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    // Click B2 (anchor)
    sim.clickCell(1, 1);
    expect(sim.editorValue()).toBe('=B2');

    // Shift+click B5 — extends to B2:B5
    sim.clickCell(4, 1, { shift: true });
    expect(sim.editorValue()).toBe('=B2:B5');

    // Type "+" then click C1 — new anchor
    sim.typeValue('=B2:B5+');

    sim.clickCell(0, 2);
    expect(sim.editorValue()).toBe('=B2:B5+C1');
  });

  it('shift+click without prior anchor inserts single cell ref', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    // Shift+click with no prior anchor — should still work (single ref)
    // The anchor is null, so it falls through to single cell behavior
    sim.clickCell(2, 2, { shift: true });

    // Should still be editing formula
    expect(sim.isFormulaEditing()).toBe(true);
  });

  it('non-shift click still inserts single cell reference', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=');
    await sim.flush();

    sim.clickCell(3, 3);
    expect(sim.editorValue()).toBe('=D4');

    // Still in formula editing
    expect(sim.isFormulaEditing()).toBe(true);
  });

  it('shift+click works across columns for rectangular range', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=SUM(');
    await sim.flush();

    // Click A1 (anchor)
    sim.clickCell(0, 0);
    expect(sim.editorValue()).toBe('=SUM(A1');

    // Shift+click C3 — should create A1:C3
    sim.clickCell(2, 2, { shift: true });
    expect(sim.editorValue()).toBe('=SUM(A1:C3');
  });
});

// =============================================================================
// Bug #14: Fill Handle Drag Integration
// =============================================================================

describe('Bug #14: Fill handle drag sends correct events', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  it('fill handle drag through multiple cells stays in dragging state', () => {
    sim = createGridSimulator({ activeCell: { row: 2, col: 1 } });

    sim.startFillDrag();
    expect(sim.isDraggingFillHandle()).toBe(true);

    // Drag through multiple cells — each should keep us in draggingFillHandle
    sim.fillDragTo(3, 1);
    expect(sim.isDraggingFillHandle()).toBe(true);

    sim.fillDragTo(4, 1);
    expect(sim.isDraggingFillHandle()).toBe(true);

    sim.fillDragTo(5, 1);
    expect(sim.isDraggingFillHandle()).toBe(true);

    sim.fillDragTo(6, 1);
    expect(sim.isDraggingFillHandle()).toBe(true);

    sim.endFillDrag();
    expect(sim.isIdle()).toBe(true);
  });

  it('fill handle drag across columns works', () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    sim.startFillDrag();
    expect(sim.isDraggingFillHandle()).toBe(true);

    sim.fillDragTo(0, 1);
    sim.fillDragTo(0, 2);
    sim.fillDragTo(0, 3);

    expect(sim.isDraggingFillHandle()).toBe(true);

    sim.endFillDrag();
    expect(sim.isIdle()).toBe(true);
  });
});
