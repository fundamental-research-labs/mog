/**
 * SDK Import/Export Conformance Tests
 *
 * Validates that public SDK consumers can open documents from various sources,
 * export to XLSX bytes, and round-trip data using ONLY public SDK entrypoints.
 *
 * Import rules:
 * - OK: MogDocumentFactory, types from @mog-sdk/contracts/sdk
 *       and @mog-sdk/contracts/api
 * - FORBIDDEN: DocumentContext, DocumentHandleInternal, ComputeBridge,
 *              IEventBus, or any @mog-sdk/kernel/internal path
 */

// Runtime imports — use relative paths within the kernel package.
// In the published @mog-sdk/kernel package these are re-exported from the root.
import { MogDocumentFactory } from '../../mog-document-factory';

// Contract types — resolved via the monorepo workspace `development` condition.
import type { MogDocument, MogDocumentOpenResult, MogImportResult } from '@mog-sdk/contracts/sdk';
import type { Workbook } from '@mog-sdk/contracts/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a headless document for testing. */
async function createTestDocument(): Promise<MogDocument> {
  return MogDocumentFactory.create({
    runtime: { kind: 'headless', userTimezone: 'UTC' },
  });
}

/** Track documents for cleanup. */
const openDocuments: MogDocument[] = [];

afterEach(async () => {
  for (const doc of openDocuments) {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  }
  openDocuments.length = 0;
});

/** Register a document for automatic cleanup. */
function track(doc: MogDocument): MogDocument {
  openDocuments.push(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// 1. MogDocumentFactory.open() with blank source
// ---------------------------------------------------------------------------

describe('MogDocumentFactory.open() with blank source', () => {
  it('opens a blank document successfully', async () => {
    const result: MogDocumentOpenResult = await MogDocumentFactory.open({
      source: { type: 'blank' },
      runtime: { kind: 'headless', userTimezone: 'UTC' },
    });

    expect(result.document).toBeDefined();
    track(result.document!);

    expect(result.importResult.success).toBe(true);
    expect(result.importResult.sheetIds.length).toBeGreaterThanOrEqual(1);
    expect(result.importResult.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. MogDocumentFactory.open() with XLSX bytes
// ---------------------------------------------------------------------------

describe('MogDocumentFactory.open() with XLSX bytes', () => {
  it('round-trips data through XLSX export and re-import', async () => {
    // Create a source document with data
    const sourceDoc = track(await createTestDocument());
    const sourceWb: Workbook = await sourceDoc.workbook();
    const sourceWs = sourceWb.activeSheet;
    await sourceWs.setCell('A1', 42);
    await sourceWs.setCell('B1', 'hello');

    // Export to XLSX bytes
    const xlsxBytes = await sourceWb.save();
    await sourceDoc.close();

    // Re-import from bytes
    const result = await MogDocumentFactory.open({
      source: { type: 'bytes', data: xlsxBytes, format: 'xlsx' },
      runtime: { kind: 'headless', userTimezone: 'UTC' },
    });

    expect(result.document).toBeDefined();
    track(result.document!);
    expect(result.importResult.success).toBe(true);

    // Read back cells from the imported workbook and verify values
    const importedWb: Workbook = await result.document!.workbook();
    const importedWs = importedWb.activeSheet;
    const cellA1 = await importedWs.getCell('A1');
    const cellB1 = await importedWs.getCell('B1');
    expect(cellA1.value).toBe(42);
    expect(cellB1.value).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// 3. MogDocumentFactory.open() with unsupported source type
// ---------------------------------------------------------------------------

describe('MogDocumentFactory.open() with unsupported source type', () => {
  it('returns failure for snapshot source type', async () => {
    const result = await MogDocumentFactory.open({
      source: { type: 'snapshot' as any, data: new Uint8Array() } as any,
      runtime: { kind: 'headless', userTimezone: 'UTC' },
    });

    expect(result.importResult.success).toBe(false);
    if (result.document) {
      track(result.document);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Import result structure
// ---------------------------------------------------------------------------

describe('Import result structure', () => {
  it('has success, sheetIds, and warnings fields', async () => {
    const result = await MogDocumentFactory.open({
      source: { type: 'blank' },
      runtime: { kind: 'headless', userTimezone: 'UTC' },
    });

    track(result.document!);
    const importResult: MogImportResult = result.importResult;

    expect(typeof importResult.success).toBe('boolean');
    expect(Array.isArray(importResult.sheetIds)).toBe(true);
    expect(Array.isArray(importResult.warnings)).toBe(true);
  });

  it('sheetIds contains strings', async () => {
    const result = await MogDocumentFactory.open({
      source: { type: 'blank' },
      runtime: { kind: 'headless', userTimezone: 'UTC' },
    });

    track(result.document!);

    for (const id of result.importResult.sheetIds) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Workbook save() returns Uint8Array
// ---------------------------------------------------------------------------

describe('Workbook save() returns Uint8Array', () => {
  it('produces non-empty XLSX bytes', async () => {
    const doc = track(await createTestDocument());
    const wb: Workbook = await doc.workbook();
    const ws = wb.activeSheet;
    await ws.setCell('A1', 'test');
    await ws.setCell('A2', 123);

    const bytes = await wb.save();

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Round-trip: export then reimport preserves data
// ---------------------------------------------------------------------------

describe('Round-trip: export then reimport preserves data', () => {
  it('preserves numeric, text, and formula values', async () => {
    // Create document with mixed content
    const doc = track(await createTestDocument());
    const wb: Workbook = await doc.workbook();
    const ws = wb.activeSheet;
    await ws.setCell('A1', 100);
    await ws.setCell('A2', '=A1*2');
    await ws.setCell('B1', 'text');

    // Export
    const xlsxBytes = await wb.save();
    await doc.close();

    // Reimport
    const result = await MogDocumentFactory.open({
      source: { type: 'bytes', data: xlsxBytes, format: 'xlsx' },
      runtime: { kind: 'headless', userTimezone: 'UTC' },
    });

    expect(result.document).toBeDefined();
    track(result.document!);
    expect(result.importResult.success).toBe(true);

    // Verify preserved data
    const importedWb: Workbook = await result.document!.workbook();
    const importedWs = importedWb.activeSheet;

    const cellA1 = await importedWs.getCell('A1');
    expect(cellA1.value).toBe(100);

    const cellB1 = await importedWs.getCell('B1');
    expect(cellB1.value).toBe('text');

    // Formula should re-evaluate to 200
    const cellA2 = await importedWs.getCell('A2');
    expect(cellA2.value).toBe(200);
  });
});
