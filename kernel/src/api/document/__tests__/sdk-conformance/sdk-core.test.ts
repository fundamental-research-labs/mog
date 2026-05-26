/**
 * SDK Core Conformance Tests
 *
 * Validates that public SDK consumers can create, open, mutate, observe,
 * save/export, and close documents using ONLY public SDK entrypoints.
 *
 * Import rules:
 * - OK: MogDocumentFactory, MogSdkError, types from @mog-sdk/kernel
 *       and @mog-sdk/contracts/sdk
 * - FORBIDDEN: DocumentContext, DocumentHandleInternal, ComputeBridge,
 *              IEventBus, or any @mog-sdk/kernel/internal path
 */

// Runtime imports — use relative paths within the kernel package.
// In the published @mog-sdk/kernel package these are re-exported from the root.
import { MogDocumentFactory } from '../../mog-document-factory';
import { MogSdkError } from '../../../../errors/mog-sdk-error';

// Contract types — resolved via the monorepo workspace `development` condition.
import type {
  MogDocument,
  MogDocumentStatus,
  MogDocumentCloseResult,
  MogDocumentPersistenceState,
  IMogDocumentHistory,
  MogUndoState,
  MogSdkErrorCode,
  MogSdkErrorJSON,
} from '@mog-sdk/contracts/sdk';
import type { Workbook } from '@mog-sdk/contracts/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a headless document for testing. */
async function createTestDocument(documentId?: string): Promise<MogDocument> {
  return MogDocumentFactory.create({
    documentId,
    runtime: { kind: 'headless', userTimezone: 'UTC' },
  });
}

// ---------------------------------------------------------------------------
// 1. MogDocumentFactory.create()
// ---------------------------------------------------------------------------

describe('MogDocumentFactory.create()', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('creates a document and returns a MogDocument', async () => {
    doc = await createTestDocument();
    expect(doc).toBeDefined();
  });

  it('has a non-empty documentId', async () => {
    doc = await createTestDocument();
    expect(typeof doc.documentId).toBe('string');
    expect(doc.documentId.length).toBeGreaterThan(0);
  });

  it('uses caller-supplied documentId when provided', async () => {
    doc = await createTestDocument('test-doc-custom-id');
    expect(doc.documentId).toBe('test-doc-custom-id');
  });

  it('has a non-empty initialSheetId', async () => {
    doc = await createTestDocument();
    expect(typeof doc.initialSheetId).toBe('string');
    expect(doc.initialSheetId.length).toBeGreaterThan(0);
  });

  it('status is ready after creation', async () => {
    doc = await createTestDocument();
    expect(doc.status).toBe('ready' satisfies MogDocumentStatus);
  });

  it('isDisposed is false after creation', async () => {
    doc = await createTestDocument();
    expect(doc.isDisposed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. document.workbook()
// ---------------------------------------------------------------------------

describe('document.workbook()', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('returns a Workbook instance', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook();
    expect(wb).toBeDefined();
  });

  it('repeated calls return the same Workbook instance', async () => {
    doc = await createTestDocument();
    const wb1 = await doc.workbook();
    const wb2 = await doc.workbook();
    expect(wb1).toBe(wb2);
  });
});

// ---------------------------------------------------------------------------
// 3. document.status transitions
// ---------------------------------------------------------------------------

describe('document.status transitions', () => {
  it('transitions through closing to closed during close()', async () => {
    const doc = await createTestDocument();
    expect(doc.status).toBe('ready' satisfies MogDocumentStatus);

    await doc.close();

    // After close resolves, status must be closed
    expect(doc.status).toBe('closed' satisfies MogDocumentStatus);
  });

  it('isDisposed is true after close', async () => {
    const doc = await createTestDocument();
    expect(doc.isDisposed).toBe(false);

    await doc.close();
    expect(doc.isDisposed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. document.history
// ---------------------------------------------------------------------------

describe('document.history', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('returns an IMogDocumentHistory', async () => {
    doc = await createTestDocument();
    const history: IMogDocumentHistory = doc.history;
    expect(history).toBeDefined();
    expect(typeof history.undo).toBe('function');
    expect(typeof history.redo).toBe('function');
    expect(typeof history.canUndo).toBe('function');
    expect(typeof history.canRedo).toBe('function');
    expect(typeof history.getState).toBe('function');
    expect(typeof history.setNextDescription).toBe('function');
    expect(typeof history.subscribe).toBe('function');
  });

  it('canUndo/canRedo return false on a fresh document', async () => {
    doc = await createTestDocument();
    expect(doc.history.canUndo()).toBe(false);
    expect(doc.history.canRedo()).toBe(false);
  });

  it('getState returns a valid MogUndoState', async () => {
    doc = await createTestDocument();
    const state: MogUndoState = await doc.history.getState();
    expect(state).toBeDefined();
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
    expect(typeof state.undoDepth).toBe('number');
    expect(typeof state.redoDepth).toBe('number');
  });

  it('subscribe returns a disposable', async () => {
    doc = await createTestDocument();
    const disposable = doc.history.subscribe((_state: MogUndoState) => {
      // no-op listener
    });
    expect(disposable).toBeDefined();
    expect(typeof disposable.dispose).toBe('function');
    disposable.dispose();
  });
});

// ---------------------------------------------------------------------------
// 5. document.persistence
// ---------------------------------------------------------------------------

describe('document.persistence', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('returns a MogDocumentPersistenceState with expected fields', async () => {
    doc = await createTestDocument();
    const p: MogDocumentPersistenceState = doc.persistence;
    expect(p).toBeDefined();
    expect(typeof p.mode).toBe('string');
    expect(typeof p.readOnly).toBe('boolean');
    expect(typeof p.pendingUpdatesCount).toBe('number');
    // lastCheckpointAt and lastSyncAt may be null initially
    expect(p.lastCheckpointAt === null || typeof p.lastCheckpointAt === 'number').toBe(true);
    expect(p.lastSyncAt === null || typeof p.lastSyncAt === 'number').toBe(true);
  });

  it('mode is a recognized durability mode', async () => {
    doc = await createTestDocument();
    const validModes = ['ephemeral', 'durableLocal', 'localFirst', 'remoteBacked', 'readOnly'];
    expect(validModes).toContain(doc.persistence.mode);
  });
});

// ---------------------------------------------------------------------------
// 6. document.close()
// ---------------------------------------------------------------------------

describe('document.close()', () => {
  it('returns a MogDocumentCloseResult', async () => {
    const doc = await createTestDocument();
    const result: MogDocumentCloseResult = await doc.close();

    expect(result).toBeDefined();
    expect(typeof result.status).toBe('string');
    expect(['closed', 'closedWithWarnings', 'closeFailed']).toContain(result.status);
    expect(Array.isArray(result.detachedProviders)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(typeof result.timestamp).toBe('number');
  });

  it('document is disposed after close', async () => {
    const doc = await createTestDocument();
    await doc.close();
    expect(doc.isDisposed).toBe(true);
    expect(doc.status).toBe('closed' satisfies MogDocumentStatus);
  });

  it('close() is idempotent (calling twice does not throw)', async () => {
    const doc = await createTestDocument();
    await doc.close();
    // Second close should not throw
    await expect(doc.close()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 7. document.disposeAsync()
// ---------------------------------------------------------------------------

describe('document.disposeAsync()', () => {
  it('works as an alternative to close()', async () => {
    const doc = await createTestDocument();
    expect(doc.isDisposed).toBe(false);

    await doc.disposeAsync();

    expect(doc.isDisposed).toBe(true);
  });

  it('Symbol.asyncDispose is defined', async () => {
    const doc = await createTestDocument();
    expect(typeof doc[Symbol.asyncDispose]).toBe('function');
    await doc.disposeAsync();
  });
});

// ---------------------------------------------------------------------------
// 8. MogSdkError construction and API
// ---------------------------------------------------------------------------

describe('MogSdkError', () => {
  it('constructs with code and message', () => {
    const err = new MogSdkError('INVALID_ARGUMENT', 'bad input');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MogSdkError);
    expect(err.name).toBe('MogSdkError');
    expect(err.code).toBe('INVALID_ARGUMENT' satisfies MogSdkErrorCode);
    expect(err.message).toBe('bad input');
  });

  it('supports details option', () => {
    const details = { field: 'row', expected: 'number' };
    const err = new MogSdkError('INVALID_ARGUMENT', 'bad row', { details });
    expect(err.details).toEqual(details);
  });

  it('supports operation option', () => {
    const err = new MogSdkError('NOT_FOUND', 'sheet missing', {
      operation: 'getSheet',
    });
    expect(err.operation).toBe('getSheet');
  });

  it('supports diagnostics option', () => {
    const err = new MogSdkError('COMPUTE_ERROR', 'circular ref', {
      diagnostics: {
        domain: 'FORMULA',
        issueCode: 'FORMULA_CIRCULAR_REFERENCE',
        severity: 'error',
      },
    });
    expect(err.diagnostics).toBeDefined();
    expect(err.diagnostics!.domain).toBe('FORMULA');
  });

  it('supports cause option', () => {
    const cause = new Error('original');
    const err = new MogSdkError('INTERNAL_ERROR', 'wrapped', { cause });
    expect(err.cause).toBe(cause);
  });

  it('toJSON() returns a valid MogSdkErrorJSON', () => {
    const err = new MogSdkError('TRANSPORT_ERROR', 'bridge down', {
      operation: 'setCellValue',
      details: { bridge: 'wasm' },
      diagnostics: { domain: 'BRIDGE', severity: 'error' },
    });
    const json: MogSdkErrorJSON = err.toJSON();

    expect(json.code).toBe('TRANSPORT_ERROR');
    expect(json.message).toBe('bridge down');
    expect(json.operation).toBe('setCellValue');
    expect(json.details).toEqual({ bridge: 'wasm' });
    expect(json.diagnostics).toBeDefined();
  });

  it('toJSON() serializes nested cause chain', () => {
    const inner = new MogSdkError('NOT_FOUND', 'inner error');
    const outer = new MogSdkError('INTERNAL_ERROR', 'outer error', {
      cause: inner,
    });
    const json = outer.toJSON();
    expect(json.cause).toBeDefined();
    expect(json.cause!.code).toBe('NOT_FOUND');
    expect(json.cause!.message).toBe('inner error');
  });

  it('toJSON() omits cause when cause is not a MogSdkError', () => {
    const err = new MogSdkError('INTERNAL_ERROR', 'wrapped', {
      cause: new Error('plain error'),
    });
    const json = err.toJSON();
    expect(json.cause).toBeUndefined();
  });

  it('from() returns the same instance for MogSdkError input', () => {
    const original = new MogSdkError('CONFLICT', 'already exists');
    const wrapped = MogSdkError.from(original);
    expect(wrapped).toBe(original);
  });

  it('from() wraps a plain Error as INTERNAL_ERROR', () => {
    const plain = new Error('something broke');
    const wrapped = MogSdkError.from(plain);
    expect(wrapped).toBeInstanceOf(MogSdkError);
    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.message).toBe('something broke');
  });

  it('from() wraps a string as INTERNAL_ERROR', () => {
    const wrapped = MogSdkError.from('string error');
    expect(wrapped).toBeInstanceOf(MogSdkError);
    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.message).toBe('string error');
  });

  it('from() attaches operation when provided', () => {
    const err = MogSdkError.from(new Error('fail'), 'myOp');
    expect(err.operation).toBe('myOp');
  });
});

// ---------------------------------------------------------------------------
// 9. Cell mutations through public SDK
// ---------------------------------------------------------------------------

describe('Cell mutations through public SDK', () => {
  let doc: MogDocument;
  let wb: Workbook;

  beforeEach(async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();
  });

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('sets and reads a numeric value', async () => {
    const ws = wb.activeSheet;
    await ws.setCell('A1', 42);
    const val = await ws.getValue('A1');
    expect(val).toBe(42);
  });

  it('sets and reads a string value', async () => {
    const ws = wb.activeSheet;
    await ws.setCell('B1', 'hello');
    const val = await ws.getValue('B1');
    expect(val).toBe('hello');
  });

  it('sets and reads a boolean value', async () => {
    const ws = wb.activeSheet;
    await ws.setCell('C1', true);
    const val = await ws.getValue('C1');
    expect(val).toBe(true);
  });

  it('sets null to clear a cell', async () => {
    const ws = wb.activeSheet;
    await ws.setCell('A1', 42);
    await ws.setCell('A1', null);
    const val = await ws.getValue('A1');
    expect(val).toBeNull();
  });

  it('sets a Date and reads back an Excel serial number', async () => {
    const ws = wb.activeSheet;
    await ws.setCell('D1', new Date('2026-01-01'));
    const val = await ws.getValue('D1');
    // Dates are stored as Excel serial numbers (numeric)
    expect(typeof val).toBe('number');
    expect(val).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Formula evaluation through public SDK
// ---------------------------------------------------------------------------

describe('Formula evaluation through public SDK', () => {
  let doc: MogDocument;
  let wb: Workbook;

  beforeEach(async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();
  });

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('evaluates a simple formula referencing another cell', async () => {
    const ws = wb.activeSheet;
    await ws.setCell('A1', 100);
    await ws.setCell('A2', '=A1*2');
    const val = await ws.getValue('A2');
    expect(val).toBe(200);
  });

  it('evaluates SUM over a range', async () => {
    const ws = wb.activeSheet;
    await ws.setCell('A1', 100);
    await ws.setCell('A2', '=A1*2');
    await ws.setCell('A3', '=SUM(A1:A2)');
    const val = await ws.getValue('A3');
    expect(val).toBe(300);
  });

  it('evaluates a cross-sheet formula', async () => {
    const ws1 = wb.activeSheet;
    const ws2 = await wb.sheets.add('Data');
    await ws2.setCell('A1', 50);
    // Reference Data!A1 from the first sheet
    await ws1.setCell('A1', `='Data'!A1+10`);
    const val = await ws1.getValue('A1');
    expect(val).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 11. Sheet operations
// ---------------------------------------------------------------------------

describe('Sheet operations', () => {
  let doc: MogDocument;
  let wb: Workbook;

  beforeEach(async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();
  });

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('activeSheet returns a Worksheet with a name', () => {
    const ws = wb.activeSheet;
    expect(ws).toBeDefined();
    expect(typeof ws.name).toBe('string');
    expect(ws.name.length).toBeGreaterThan(0);
  });

  it('sheets.add() creates a new sheet', async () => {
    const countBefore = wb.sheetCount;
    const newWs = await wb.sheets.add('NewSheet');
    expect(newWs).toBeDefined();
    expect(newWs.name).toBe('NewSheet');
    expect(wb.sheetCount).toBe(countBefore + 1);
  });

  it('getSheet() retrieves the created sheet by name', async () => {
    await wb.sheets.add('LookupSheet');
    const ws = await wb.getSheet('LookupSheet');
    expect(ws).toBeDefined();
    expect(ws.name).toBe('LookupSheet');
  });

  it('sheetNames includes the new sheet name', async () => {
    await wb.sheets.add('TrackedSheet');
    expect(wb.sheetNames).toContain('TrackedSheet');
  });

  it('sheetCount is correct after adding sheets', async () => {
    const initial = wb.sheetCount;
    await wb.sheets.add('Extra1');
    await wb.sheets.add('Extra2');
    expect(wb.sheetCount).toBe(initial + 2);
  });
});

// ---------------------------------------------------------------------------
// 12. Range operations
// ---------------------------------------------------------------------------

describe('Range operations', () => {
  let doc: MogDocument;
  let wb: Workbook;

  beforeEach(async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();
  });

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('getRange returns a 2D array of CellData', async () => {
    const ws = wb.activeSheet;
    await ws.setCell('A1', 1);
    await ws.setCell('B1', 2);
    await ws.setCell('A2', 3);
    await ws.setCell('B2', 4);
    const range = await ws.getRange('A1:B2');
    expect(Array.isArray(range)).toBe(true);
    expect(range.length).toBe(2);
    expect(range[0].length).toBe(2);
    // Each element should be a CellData object with a value property
    expect(range[0][0]).toHaveProperty('value');
    expect(range[0][0].value).toBe(1);
    expect(range[1][1].value).toBe(4);
  });

  it('setCells writes multiple cells in a single call', async () => {
    const ws = wb.activeSheet;
    await ws.setCells([
      { addr: 'A1', value: 1 },
      { addr: 'A2', value: 2 },
      { addr: 'A3', value: 3 },
    ]);
    const v1 = await ws.getValue('A1');
    const v2 = await ws.getValue('A2');
    const v3 = await ws.getValue('A3');
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    expect(v3).toBe(3);
  });

  it('getValues reads a range as a 2D value array', async () => {
    const ws = wb.activeSheet;
    await ws.setCells([
      { addr: 'A1', value: 10 },
      { addr: 'A2', value: 20 },
      { addr: 'A3', value: 30 },
    ]);
    const values = await ws.getValues('A1:A3');
    expect(Array.isArray(values)).toBe(true);
    expect(values.length).toBe(3);
    // getValues returns 2D array — each row is an array
    expect(values[0][0]).toBe(10);
    expect(values[1][0]).toBe(20);
    expect(values[2][0]).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// 13. Workbook referential stability
// ---------------------------------------------------------------------------

describe('Workbook referential stability', () => {
  it('doc.workbook() returns the same instance on repeated calls', async () => {
    const doc = await createTestDocument();
    const wb1 = await doc.workbook();
    const wb2 = await doc.workbook();
    expect(wb1).toBe(wb2);
    await doc.close();
  });

  it('closing workbook marks the document as disposed', async () => {
    const doc = await createTestDocument();
    const wb = await doc.workbook();
    expect(doc.isDisposed).toBe(false);
    await wb.close('skipSave');
    expect(doc.isDisposed).toBe(true);
  });
});
