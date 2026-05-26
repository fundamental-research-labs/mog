/**
 * BLUR Machine Event Tests
 *
 * Documents the editor state machine's BLUR contract:
 * - BLUR is a side effect, not an intent. It does NOT transition out of
 * editing / formulaEditing / richTextEditing. Commit-on-click and
 * commit-on-sheet-switch flow through explicit COMMIT events dispatched
 * by the click interceptor and sheet-switch coordinator respectively.
 * - The single carveout is `imeComposing`: IME composition completes via
 * DOM blur as a deliberate OS-level signal, so BLUR there commits the
 * composed text and validates.
 */
import { createGridSimulator, type GridSimulator } from '../grid-simulator';

describe('BLUR machine event', () => {
  let sim: GridSimulator;

  afterEach(() => {
    sim.destroy();
  });

  it('BLUR during editing does not transition (blur is a side effect)', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('hello');
    sim.typeValue('hello');
    expect(sim.isEditing()).toBe(true);

    const editorActor = sim.system.access.actors.editor;
    editorActor.send({ type: 'BLUR' });
    await sim.flush();

    // Editor stays in editing — only explicit COMMIT/CANCEL/PICKER_COMMIT leave
    expect(sim.isEditing()).toBe(true);
    expect(editorActor.getSnapshot().matches('editing')).toBe(true);
  });

  it('BLUR during formula editing does not transition (blur is a side effect)', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('=SUM(');
    expect(sim.isEditing()).toBe(true);

    const editorActor = sim.system.access.actors.editor;
    editorActor.send({ type: 'BLUR' });
    await sim.flush();

    // Formula editor preserved — sheet-tab clicks, overlay openings, etc. must
    // not commit a half-typed formula. This is the load-bearing invariant for
    // cross-sheet formula building.
    expect(editorActor.getSnapshot().matches('formulaEditing')).toBe(true);
  });

  it('BLUR during IME composing commits the composition (carveout)', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('');
    const editorActor = sim.system.access.actors.editor;
    editorActor.send({ type: 'IME_START' });
    editorActor.send({ type: 'IME_UPDATE', compositionText: '中' });
    await sim.flush();

    expect(sim.isEditing()).toBe(true);

    editorActor.send({ type: 'BLUR' });
    await sim.flush();

    // Coordinator does NOT auto-complete from imeComposing→validating
    // (wasEditing checks editing/formulaEditing only); machine reaches
    // validating, then we complete the cycle manually for the test.
    expect(editorActor.getSnapshot().value).toBe('validating');

    editorActor.send({ type: 'VALIDATION_SUCCESS' });
    editorActor.send({ type: 'COMMIT_COMPLETE' });
    await sim.flush();
    expect(editorActor.getSnapshot().value).toBe('inactive');
  });

  it('BLUR in inactive state is a no-op', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    const editorActor = sim.system.access.actors.editor;
    expect(editorActor.getSnapshot().value).toBe('inactive');

    editorActor.send({ type: 'BLUR' });
    await sim.flush();

    expect(editorActor.getSnapshot().value).toBe('inactive');
  });

  it('BLUR in error state stays in error', async () => {
    sim = createGridSimulator({ activeCell: { row: 0, col: 0 }, sheetId: 'sheet-1' });

    sim.startEditing('invalid');
    const editorActor = sim.system.access.actors.editor;

    // Reach error state via IME path (coordinator doesn't auto-complete)
    editorActor.send({ type: 'IME_START' });
    editorActor.send({ type: 'IME_UPDATE', compositionText: 'x' });
    editorActor.send({ type: 'BLUR' });
    await sim.flush();
    expect(editorActor.getSnapshot().value).toBe('validating');

    editorActor.send({ type: 'VALIDATION_ERROR', message: 'test error' });
    await sim.flush();
    expect(editorActor.getSnapshot().value).toBe('error');

    // BLUR while in error state should stay in error
    editorActor.send({ type: 'BLUR' });
    await sim.flush();

    expect(editorActor.getSnapshot().value).toBe('error');
  });
});
