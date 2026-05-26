/**
 * Cell-Click-During-Editing Tests
 *
 * Regression coverage for the BLUR decoupling fix
 *
 * Contract:
 * - The editor state machine treats DOM blur as a side effect, not an intent.
 * In editing/formulaEditing/richTextEditing, BLUR does not transition.
 * - Commit-on-click during a regular edit goes through an explicit COMMIT
 * from `setupEditingInputInterception.interceptCellClick`.
 * - Click during formulaEditing Enter Mode inserts a cell reference
 * (Excel parity) — the editor stays open.
 * - Shift-click during formulaEditing extends the range reference.
 *
 * @see ../../coordination/cross-coordination.ts setupEditingInputInterception
 * @see ../../machines/grid-editor-machine.ts (BLUR is only handled in imeComposing)
 */

import { createGridSimulator, type GridSimulator } from '../grid-simulator';

async function completeCommit(sim: GridSimulator): Promise<void> {
  const editorActor = sim.system.access.actors.editor;
  editorActor.send({ type: 'VALIDATION_SUCCESS' });
  await sim.flush();
  editorActor.send({ type: 'COMMIT_COMPLETE' });
  await sim.flush();
}

describe('Cell click during editing', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim?.destroy();
  });

  // ---------------------------------------------------------------------------
  // (a) Regular edit — click another cell commits and selection moves
  // ---------------------------------------------------------------------------

  it('click another cell during regular edit commits, selection moves, not editing', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    sim.startEditing('hello');
    expect(sim.isEditing()).toBe(true);
    expect(sim.isFormulaEditing()).toBe(false);

    sim.clickCell(3, 4);
    await completeCommit(sim);

    // Editor closed via explicit COMMIT (NOT via BLUR — the machine no longer
    // honors BLUR in editing). Selection moved to clicked cell.
    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 3, col: 4 });
  });

  // ---------------------------------------------------------------------------
  // (b) Formula edit — click another cell inserts ref, editor stays open
  // ---------------------------------------------------------------------------

  it('click another cell during formula edit inserts ref and remains editing', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    sim.startEditing('=SUM(');
    await sim.flush();
    expect(sim.isFormulaEditing()).toBe(true);

    sim.clickCell(2, 3);

    // Excel parity: clicking during a formula entry inserts a cell ref;
    // the editor stays open so the user can continue building the formula.
    expect(sim.isFormulaEditing()).toBe(true);
    expect(sim.isEditing()).toBe(true);
    expect(sim.editorValue()).toBe('=SUM(D3');
    // Active cell stays at the formula cell (didn't navigate away).
    expect(sim.activeCell()).toEqual({ row: 0, col: 0 });
  });

  // ---------------------------------------------------------------------------
  // (c) Shift-click during formula edit extends the range reference
  // ---------------------------------------------------------------------------

  it('shift-click during formula edit extends range reference, still editing', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    sim.startEditing('=SUM(');
    await sim.flush();

    // First click sets the anchor and inserts a single-cell ref.
    sim.clickCell(1, 0);
    expect(sim.editorValue()).toBe('=SUM(A2');

    // Shift-click extends to a range A2:A5 anchored at the first click.
    sim.clickCell(4, 0, { shift: true });

    expect(sim.editorValue()).toBe('=SUM(A2:A5');
    expect(sim.isFormulaEditing()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // (d) BLUR alone does not commit a regular edit
  // ---------------------------------------------------------------------------

  it('raw BLUR does not commit a regular edit (blur is a side effect, not an intent)', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    sim.startEditing('hello');
    sim.typeValue('hello');
    expect(sim.isEditing()).toBe(true);

    const editorActor = sim.system.access.actors.editor;
    editorActor.send({ type: 'BLUR' });
    await sim.flush();

    // Pre-fix: this would transition validating→committing→inactive.
    // Post-fix: BLUR is ignored in editing/formulaEditing/richTextEditing.
    expect(sim.isEditing()).toBe(true);
    expect(editorActor.getSnapshot().matches('editing')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // (e) BLUR alone does not commit a formula edit (cross-sheet entry safety)
  // ---------------------------------------------------------------------------

  it('raw BLUR does not commit a formula edit (cross-sheet formula entry safety)', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });

    sim.startEditing('=SUM(');
    await sim.flush();
    expect(sim.isFormulaEditing()).toBe(true);

    const editorActor = sim.system.access.actors.editor;
    editorActor.send({ type: 'BLUR' });
    await sim.flush();

    // The whole point of the fix: a blur source (sheet-tab click, overlay
    // open, validation popup, etc.) must NOT prematurely commit `=SUM(`.
    expect(editorActor.getSnapshot().matches('formulaEditing')).toBe(true);
    expect(sim.editorValue()).toBe('=SUM(');
  });
});
