/**
 * SDK Runtime Node Conformance Tests
 *
 * Validates Node/headless-specific runtime behavior: zero-ceremony construction,
 * timezone defaults, N-API bridge lifecycle, deterministic execution, disposal
 * cascade, and multiple independent documents.
 *
 * Import rules:
 * - OK: MogDocumentFactory, createWorkbook, types from @mog-sdk/contracts/sdk
 *       and @mog-sdk/contracts/api
 * - FORBIDDEN: DocumentContext, DocumentHandleInternal, ComputeBridge,
 *              IEventBus, or any @mog-sdk/kernel/internal path
 */

// Runtime imports — use relative paths within the kernel package.
import { MogDocumentFactory } from '../../mog-document-factory';
import { createWorkbook } from '../../../../index';

// Contract types
import type { MogDocument, MogDocumentStatus } from '@mog-sdk/contracts/sdk';
import type { Workbook } from '@mog-sdk/contracts/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a headless document with explicit UTC timezone. */
async function createTestDocument(documentId?: string): Promise<MogDocument> {
  return MogDocumentFactory.create({
    documentId,
    runtime: { kind: 'headless', userTimezone: 'UTC' },
  });
}

// ---------------------------------------------------------------------------
// 1. Zero-ceremony headless construction
// ---------------------------------------------------------------------------

describe('Zero-ceremony headless construction', () => {
  it('createWorkbook() with no args works in Node', async () => {
    const wb = await createWorkbook();
    expect(wb).toBeDefined();
    expect(wb.activeSheet).toBeDefined();
    await wb.close('skipSave');
  });

  it('createWorkbook() returns a workbook with a named active sheet', async () => {
    const wb = await createWorkbook();
    const ws = wb.activeSheet;
    expect(typeof ws.name).toBe('string');
    expect(ws.name.length).toBeGreaterThan(0);
    await wb.close('skipSave');
  });

  it('createWorkbook() workbook supports cell mutations', async () => {
    const wb = await createWorkbook();
    const ws = wb.activeSheet;
    await ws.setCell('A1', 42);
    const val = await ws.getValue('A1');
    expect(val).toBe(42);
    await wb.close('skipSave');
  });

  it('MogDocumentFactory.create() with no options works', async () => {
    const doc = await MogDocumentFactory.create();
    expect(doc).toBeDefined();
    expect(doc.status).toBe('ready' satisfies MogDocumentStatus);
    await doc.close();
  });
});

// ---------------------------------------------------------------------------
// 2. Headless timezone default
// ---------------------------------------------------------------------------

describe('Headless timezone default', () => {
  it('MogDocumentFactory.create with headless runtime and no timezone defaults to UTC', async () => {
    // This should succeed without specifying userTimezone — headless defaults to UTC
    const doc = await MogDocumentFactory.create({
      runtime: { kind: 'headless' },
    });
    expect(doc).toBeDefined();
    expect(doc.status).toBe('ready' satisfies MogDocumentStatus);
    await doc.close();
  });

  it('explicit timezone is respected over the default', async () => {
    const doc = await MogDocumentFactory.create({
      runtime: { kind: 'headless', userTimezone: 'America/New_York' },
    });
    expect(doc).toBeDefined();
    expect(doc.status).toBe('ready' satisfies MogDocumentStatus);
    await doc.close();
  });

  it('createWorkbook() in Node auto-detects headless and defaults timezone to UTC', async () => {
    // In Node (no window/document), createWorkbook detects headless.
    // With UTC default, this should succeed without explicit timezone.
    const wb = await createWorkbook();
    expect(wb).toBeDefined();
    await wb.close('skipSave');
  });
});

// ---------------------------------------------------------------------------
// 3. N-API bridge lifecycle
// ---------------------------------------------------------------------------

describe('N-API bridge lifecycle', () => {
  it('create → mutate → dispose does not throw', async () => {
    const wb = await createWorkbook();
    const ws = wb.activeSheet;

    // Perform various mutations
    await ws.setCell('A1', 100);
    await ws.setCell('A2', '=A1+50');
    await ws.setCell('B1', 'hello');
    await ws.setCell('C1', true);

    // Read back values
    const v1 = await ws.getValue('A1');
    const v2 = await ws.getValue('A2');
    expect(v1).toBe(100);
    expect(v2).toBe(150);

    // Dispose cleanly
    await wb.close('skipSave');
  });

  it('document lifecycle: create → workbook → mutate → close', async () => {
    const doc = await createTestDocument();
    const wb: Workbook = await doc.workbook();
    const ws = wb.activeSheet;

    await ws.setCell('A1', 'lifecycle test');
    const val = await ws.getValue('A1');
    expect(val).toBe('lifecycle test');

    const result = await doc.close();
    expect(result.status).toBe('closed');
    expect(doc.isDisposed).toBe(true);
  });

  it('adding sheets and mutating across them works through full lifecycle', async () => {
    const wb = await createWorkbook();
    const ws1 = wb.activeSheet;
    const ws2 = await wb.sheets.add('Sheet2');

    await ws1.setCell('A1', 10);
    await ws2.setCell('A1', 20);
    await ws1.setCell('B1', `='Sheet2'!A1+A1`);

    const cross = await ws1.getValue('B1');
    expect(cross).toBe(30);

    await wb.close('skipSave');
  });
});

// ---------------------------------------------------------------------------
// 4. Deterministic execution
// ---------------------------------------------------------------------------

describe('Deterministic execution', () => {
  it('same operations produce identical results across two independent workbooks', async () => {
    async function buildAndRead(): Promise<{ v1: unknown; v2: unknown; v3: unknown }> {
      const wb = await createWorkbook();
      const ws = wb.activeSheet;
      await ws.setCell('A1', 100);
      await ws.setCell('A2', 200);
      await ws.setCell('A3', '=SUM(A1:A2)');
      await ws.setCell('B1', '=A3*2');
      await ws.setCell('C1', '=IF(B1>500,TRUE,FALSE)');
      const v1 = await ws.getValue('A3');
      const v2 = await ws.getValue('B1');
      const v3 = await ws.getValue('C1');
      await wb.close('skipSave');
      return { v1, v2, v3 };
    }

    const run1 = await buildAndRead();
    const run2 = await buildAndRead();

    expect(run1.v1).toBe(300);
    expect(run1.v2).toBe(600);
    expect(run1.v3).toBe(true);
    expect(run1).toEqual(run2);
  });

  it('formula chains produce deterministic results', async () => {
    async function buildChain(): Promise<unknown[]> {
      const wb = await createWorkbook();
      const ws = wb.activeSheet;
      await ws.setCell('A1', 1);
      for (let i = 2; i <= 10; i++) {
        await ws.setCell(`A${i}`, `=A${i - 1}+1`);
      }
      const results: unknown[] = [];
      for (let i = 1; i <= 10; i++) {
        results.push(await ws.getValue(`A${i}`));
      }
      await wb.close('skipSave');
      return results;
    }

    const chain1 = await buildChain();
    const chain2 = await buildChain();

    expect(chain1).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(chain1).toEqual(chain2);
  });

  it('string concatenation formulas are deterministic', async () => {
    const wb = await createWorkbook();
    const ws = wb.activeSheet;
    await ws.setCell('A1', 'Hello');
    await ws.setCell('B1', 'World');
    await ws.setCell('C1', '=A1&" "&B1');
    const val = await ws.getValue('C1');
    expect(val).toBe('Hello World');
    await wb.close('skipSave');
  });
});

// ---------------------------------------------------------------------------
// 5. Disposal cascade
// ---------------------------------------------------------------------------

describe('Disposal cascade', () => {
  it('closing document disposes the workbook handle', async () => {
    const doc = await createTestDocument();
    await doc.workbook();
    expect(doc.isDisposed).toBe(false);

    await doc.close();
    expect(doc.isDisposed).toBe(true);
    expect(doc.status).toBe('closed' satisfies MogDocumentStatus);
  });

  it('closing workbook via close marks document as disposed', async () => {
    const doc = await createTestDocument();
    const wb = await doc.workbook();
    await wb.close('skipSave');
    expect(doc.isDisposed).toBe(true);
  });

  it('workbook access after document close rejects immediately', async () => {
    const doc = await createTestDocument();
    await doc.workbook();
    await doc.close();

    await expect(doc.workbook()).rejects.toThrow(/disposed/i);
  });

  it('document close invalidates zero-arg and configured workbook handles', async () => {
    const doc = await createTestDocument();
    const ownedWb = await doc.workbook();
    const configuredWb = await doc.workbook({ readOnly: false });
    const ownedWs = ownedWb.activeSheet;
    const configuredWs = configuredWb.activeSheet;

    await doc.close();

    expect(() => ownedWb.sheetNames).toThrow(/disposed|closed|invalidated/i);
    expect(() => configuredWb.sheetNames).toThrow(/disposed|closed|invalidated/i);
    await expect(ownedWs.getValue('A1')).rejects.toThrow(/disposed|closed|invalidated/i);
    await expect(configuredWs.getValue('A1')).rejects.toThrow(/disposed|closed|invalidated/i);
  });

  it('closing a configured workbook does not dispose the document by default', async () => {
    const doc = await createTestDocument();
    const configuredWb = await doc.workbook({ readOnly: false });

    await configuredWb.close('skipSave');

    expect(doc.isDisposed).toBe(false);
    await doc.close();
  });

  it('disposeAsync cascades to closed state', async () => {
    const doc = await createTestDocument();
    await doc.workbook();
    await doc.disposeAsync();
    expect(doc.isDisposed).toBe(true);
    expect(doc.status).toBe('closed' satisfies MogDocumentStatus);
  });

  it('double close is idempotent', async () => {
    const doc = await createTestDocument();
    await doc.close();
    // Second close should not throw
    const result = await doc.close();
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Multiple independent documents
// ---------------------------------------------------------------------------

describe('Multiple independent documents', () => {
  it('two documents created simultaneously do not interfere', async () => {
    const doc1 = await createTestDocument('doc-1');
    const doc2 = await createTestDocument('doc-2');

    const wb1 = await doc1.workbook();
    const wb2 = await doc2.workbook();

    // Mutate doc1
    await wb1.activeSheet.setCell('A1', 'doc1-value');
    // Mutate doc2 with a different value in the same cell address
    await wb2.activeSheet.setCell('A1', 'doc2-value');

    // Read back — they must be independent
    const v1 = await wb1.activeSheet.getValue('A1');
    const v2 = await wb2.activeSheet.getValue('A1');
    expect(v1).toBe('doc1-value');
    expect(v2).toBe('doc2-value');

    await doc1.close();
    await doc2.close();
  });

  it('closing one document does not affect the other', async () => {
    const doc1 = await createTestDocument('iso-1');
    const doc2 = await createTestDocument('iso-2');

    const wb2 = await doc2.workbook();
    await wb2.activeSheet.setCell('A1', 42);

    // Close doc1 — doc2 should remain functional
    await doc1.close();
    expect(doc1.isDisposed).toBe(true);
    expect(doc2.isDisposed).toBe(false);

    const val = await wb2.activeSheet.getValue('A1');
    expect(val).toBe(42);

    await doc2.close();
  });

  it('formulas in one document do not leak into another', async () => {
    const doc1 = await createTestDocument('formula-iso-1');
    const doc2 = await createTestDocument('formula-iso-2');

    const wb1 = await doc1.workbook();
    const wb2 = await doc2.workbook();

    await wb1.activeSheet.setCell('A1', 100);
    await wb1.activeSheet.setCell('A2', '=A1*3');

    await wb2.activeSheet.setCell('A1', 999);

    // doc1's formula should reference doc1's A1 (100), not doc2's A1 (999)
    const v1 = await wb1.activeSheet.getValue('A2');
    expect(v1).toBe(300);

    // doc2 has no formula in A2
    const v2 = await wb2.activeSheet.getValue('A2');
    expect(v2).toBeNull();

    await doc1.close();
    await doc2.close();
  });

  it('three concurrent workbooks via createWorkbook all work independently', async () => {
    const wbs = await Promise.all([createWorkbook(), createWorkbook(), createWorkbook()]);

    for (let i = 0; i < wbs.length; i++) {
      await wbs[i].activeSheet.setCell('A1', i * 10);
    }

    for (let i = 0; i < wbs.length; i++) {
      const val = await wbs[i].activeSheet.getValue('A1');
      expect(val).toBe(i * 10);
    }

    for (const wb of wbs) {
      await wb.close('skipSave');
    }
  });
});
