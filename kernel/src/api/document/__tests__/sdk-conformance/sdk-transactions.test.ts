/**
 * SDK Transactions Conformance Tests
 *
 * Validates batch/undoGroup semantics through the public SDK contract.
 *
 * Import rules:
 * - OK: MogDocumentFactory, types from @mog-sdk/contracts/sdk and /api
 * - FORBIDDEN: DocumentContext, IEventBus, ComputeBridge, @mog-sdk/kernel/internal
 */

import { MogDocumentFactory } from '../../mog-document-factory';
import type { MogDocument } from '@mog-sdk/contracts/sdk';
import type { Workbook, Worksheet } from '@mog-sdk/contracts/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestDocument(): Promise<MogDocument> {
  return MogDocumentFactory.create({
    runtime: { kind: 'headless', userTimezone: 'UTC' },
  });
}

// ---------------------------------------------------------------------------
// 1. undoGroup basics
// ---------------------------------------------------------------------------

describe('undoGroup()', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('groups multiple mutations into a single undo step', async () => {
    doc = await createTestDocument();
    const wb = await doc.workbook();
    const ws = wb.activeSheet;

    await ws.setCell('A1', 10);

    await wb.undoGroup(async (w) => {
      const s = w.activeSheet;
      await s.setCell('A2', 20);
      await s.setCell('A3', 30);
    });

    expect(await ws.getValue('A2')).toBe(20);
    expect(await ws.getValue('A3')).toBe(30);

    // Single undo should revert both A2 and A3
    await doc.history.undo();

    expect(await ws.getValue('A2')).toBeNull();
    expect(await ws.getValue('A3')).toBeNull();
    // A1 was set before the group — should still be there
    expect(await ws.getValue('A1')).toBe(10);
  });

  it('returns the value produced by fn', async () => {
    doc = await createTestDocument();
    const wb = await doc.workbook();
    const ws = wb.activeSheet;

    const result = await wb.undoGroup(async (w) => {
      await w.activeSheet.setCell('A1', 42);
      return 'done';
    });

    expect(result).toBe('done');
  });

  it('partial writes persist if fn throws (non-atomic)', async () => {
    doc = await createTestDocument();
    const wb = await doc.workbook();
    const ws = wb.activeSheet;

    await expect(
      wb.undoGroup(async (w) => {
        await w.activeSheet.setCell('A1', 999);
        throw new Error('intentional');
      }),
    ).rejects.toThrow('intentional');

    // The write should have persisted (non-atomic contract)
    expect(await ws.getValue('A1')).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// 2. batch(label, fn)
// ---------------------------------------------------------------------------

describe('batch(label, fn)', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('groups mutations with a label for undo', async () => {
    doc = await createTestDocument();
    const wb = await doc.workbook();
    const ws = wb.activeSheet;

    await wb.batch('Import data', async (w) => {
      const s = w.activeSheet;
      await s.setCell('A1', 1);
      await s.setCell('A2', 2);
      await s.setCell('A3', 3);
    });

    expect(await ws.getValue('A1')).toBe(1);
    expect(await ws.getValue('A2')).toBe(2);
    expect(await ws.getValue('A3')).toBe(3);

    // Single undo reverts all three
    await doc.history.undo();

    expect(await ws.getValue('A1')).toBeNull();
    expect(await ws.getValue('A2')).toBeNull();
    expect(await ws.getValue('A3')).toBeNull();
  });

  it('returns the value produced by fn', async () => {
    doc = await createTestDocument();
    const wb = await doc.workbook();

    const result = await wb.batch('test', async (w) => {
      await w.activeSheet.setCell('A1', 1);
      return 42;
    });

    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 3. History state tracking after mutations
// ---------------------------------------------------------------------------

describe('History state after mutations', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('canUndo becomes true after a mutation', async () => {
    doc = await createTestDocument();
    const wb = await doc.workbook();
    const ws = wb.activeSheet;

    expect(doc.history.canUndo()).toBe(false);

    await ws.setCell('A1', 42);

    expect(doc.history.canUndo()).toBe(true);
  });

  it('canRedo becomes true after undo', async () => {
    doc = await createTestDocument();
    const wb = await doc.workbook();
    const ws = wb.activeSheet;

    await ws.setCell('A1', 42);
    await doc.history.undo();

    expect(doc.history.canRedo()).toBe(true);
  });

  it('redo restores the undone value', async () => {
    doc = await createTestDocument();
    const wb = await doc.workbook();
    const ws = wb.activeSheet;

    await ws.setCell('A1', 42);
    await doc.history.undo();
    expect(await ws.getValue('A1')).toBeNull();

    await doc.history.redo();
    expect(await ws.getValue('A1')).toBe(42);
  });

  it('getState reflects undo/redo depth', async () => {
    doc = await createTestDocument();
    const wb = await doc.workbook();
    const ws = wb.activeSheet;

    const stateBefore = await doc.history.getState();
    expect(stateBefore.undoDepth).toBe(0);
    expect(stateBefore.redoDepth).toBe(0);

    await ws.setCell('A1', 1);
    await ws.setCell('A2', 2);

    const stateAfterMutations = await doc.history.getState();
    expect(stateAfterMutations.undoDepth).toBeGreaterThan(0);
    expect(stateAfterMutations.canUndo).toBe(true);

    await doc.history.undo();

    const stateAfterUndo = await doc.history.getState();
    expect(stateAfterUndo.redoDepth).toBeGreaterThan(0);
    expect(stateAfterUndo.canRedo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. History subscription
// ---------------------------------------------------------------------------

describe('History subscription', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('fires on undo/redo state changes', async () => {
    doc = await createTestDocument();
    const wb = await doc.workbook();
    const ws = wb.activeSheet;

    const states: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    const sub = doc.history.subscribe((state) => {
      states.push({ canUndo: state.canUndo, canRedo: state.canRedo });
    });

    await ws.setCell('A1', 42);

    // Allow async listeners to fire
    await new Promise((r) => setTimeout(r, 100));

    expect(states.length).toBeGreaterThan(0);

    sub.dispose();
  });
});
