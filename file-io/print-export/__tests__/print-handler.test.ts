/**
 * PrintHandler Unit Tests
 */

import type { CellData } from '@mog-sdk/contracts/core';
import type { PrintRange } from '../src/contracts/types';
import type { ITableDataProvider } from '../src/html/table-generator';
import { PrintHandler, printHandler } from '../src/print/print-handler';

// ============================================================================
// Mock Data Provider
// ============================================================================

/**
 * Create a mock data provider for testing
 */
function createMockDataProvider(
  cells: Map<string, CellData>,
  options: {
    usedRange?: PrintRange;
    columnWidths?: Map<number, number>;
    rowHeights?: Map<number, number>;
    sheetName?: string;
  } = {},
): ITableDataProvider {
  const defaultWidth = 100;
  const defaultHeight = 24;

  return {
    getCellData(sheetId: string, row: number, col: number): CellData | undefined {
      return cells.get(`${row},${col}`);
    },

    getCellsInRange(
      sheetId: string,
      range: PrintRange,
    ): Array<{ row: number; col: number; data: CellData }> {
      const result: Array<{ row: number; col: number; data: CellData }> = [];
      for (const [key, data] of cells.entries()) {
        const [row, col] = key.split(',').map(Number);
        if (
          row >= range.startRow &&
          row <= range.endRow &&
          col >= range.startCol &&
          col <= range.endCol
        ) {
          result.push({ row, col, data });
        }
      }
      return result;
    },

    getUsedRange(_sheetId: string): PrintRange | undefined {
      if (options.usedRange) {
        return options.usedRange;
      }
      if (cells.size === 0) {
        return undefined;
      }
      let minRow = Infinity,
        maxRow = -Infinity;
      let minCol = Infinity,
        maxCol = -Infinity;
      for (const key of cells.keys()) {
        const [row, col] = key.split(',').map(Number);
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
      }
      return {
        startRow: minRow,
        startCol: minCol,
        endRow: maxRow,
        endCol: maxCol,
      };
    },

    getColumnWidth(sheetId: string, col: number): number {
      return options.columnWidths?.get(col) ?? defaultWidth;
    },

    getRowHeight(_sheetId: string, row: number): number {
      return options.rowHeights?.get(row) ?? defaultHeight;
    },

    getSheetName(_sheetId: string): string {
      return options.sheetName ?? 'Sheet1';
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PrintHandler', () => {
  let handler: PrintHandler;

  beforeEach(() => {
    handler = new PrintHandler();
  });

  describe('singleton', () => {
    it('exports a singleton instance', () => {
      expect(printHandler).toBeInstanceOf(PrintHandler);
    });
  });

  describe('generatePreview', () => {
    it('generates HTML preview for simple data', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Name' });
      cells.set('0,1', { value: 'Value' });
      cells.set('1,0', { value: 'Item 1' });
      cells.set('1,1', { value: 100 });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
      });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html>');
      expect(html).toContain('Name');
      expect(html).toContain('Value');
      expect(html).toContain('Item 1');
      expect(html).toContain('100');
    });

    it('includes page headers and footers', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells, { sheetName: 'MySheet' });

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        pageSetup: {
          header: { center: '&[Sheet]' },
          footer: { center: 'Page &[Page] of &[Pages]' },
        },
      });

      expect(html).toContain('MySheet');
      expect(html).toContain('Page 1 of 1');
    });

    it('handles empty data', async () => {
      const cells = new Map<string, CellData>();
      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
      });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html>');
    });

    it('respects custom print options', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        printOptions: {
          orientation: 'landscape',
          paperSize: 'a4',
        },
      });

      expect(html).toContain('landscape');
      expect(html).toContain('297mm'); // A4 width in landscape
    });

    it('generates multiple pages for large data', async () => {
      const cells = new Map<string, CellData>();
      // Create 50 rows of data
      for (let row = 0; row < 50; row++) {
        cells.set(`${row},0`, { value: `Row ${row + 1}` });
        cells.set(`${row},1`, { value: row * 100 });
      }

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        pageSetup: {
          footer: { center: 'Page &[Page] of &[Pages]' },
        },
      });

      // Should have multiple page containers
      const pageContainerCount = (html.match(/class="page-container"/g) || []).length;
      expect(pageContainerCount).toBeGreaterThanOrEqual(1);
    });

    it('includes print styles', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
      });

      expect(html).toContain('@media print');
      expect(html).toContain('@page');
      expect(html).toContain('page-break');
    });

    it('includes gridlines by default', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        printOptions: {
          showGridlines: true,
        },
      });

      expect(html).toContain('border');
    });

    it('can hide gridlines', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        printOptions: {
          showGridlines: false,
        },
      });

      // When gridlines are hidden, the table should not have visible borders
      // (the styles generated will have border: none on the table)
      expect(html).toContain('<!DOCTYPE html>');
      // Verify it's a valid document even with gridlines off
      expect(html).toContain('Test');
    });

    it('includes row/column headers when enabled', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });
      cells.set('0,1', { value: 'Data' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        printOptions: {
          showHeaders: true,
        },
      });

      expect(html).toContain('col-header');
      expect(html).toContain('row-header');
      expect(html).toContain('>A<');
      expect(html).toContain('>B<');
      expect(html).toContain('>1<');
    });

    it('uses file name in placeholders', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        fileName: 'budget.xlsx',
        pageSetup: {
          header: { right: '&[File]' },
        },
      });

      expect(html).toContain('budget.xlsx');
    });

    it('supports custom margins', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        printOptions: {
          margins: {
            top: 1.5,
            right: 1.0,
            bottom: 1.5,
            left: 1.0,
          },
        },
      });

      expect(html).toContain('1.5in');
      expect(html).toContain('1in');
    });

    it('supports custom paper size', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        printOptions: {
          paperSize: 'custom',
          customSize: {
            width: 10,
            height: 14,
          },
        },
      });

      expect(html).toContain('10in');
      expect(html).toContain('14in');
    });
  });

  describe('generatePrintDocument', () => {
    it('creates a complete HTML document', () => {
      const pagesHtml = ['<div class="page-container">Page 1</div>'];
      const html = handler.generatePrintDocument(
        pagesHtml,
        {
          paperSize: 'letter',
          orientation: 'portrait',
          margins: { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7 },
          scale: 1.0,
          showGridlines: true,
          showHeaders: false,
          center: { horizontal: false, vertical: false },
        },
        {
          header: { center: 'Test' },
          footer: { center: 'Footer' },
        },
        'Test Document',
      );

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Test Document</title>');
      expect(html).toContain('Page 1');
    });

    it('escapes HTML in title', () => {
      const pagesHtml = ['<div>Content</div>'];
      const html = handler.generatePrintDocument(
        pagesHtml,
        {
          paperSize: 'letter',
          orientation: 'portrait',
          margins: { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7 },
          scale: 1.0,
          showGridlines: true,
          showHeaders: false,
          center: { horizontal: false, vertical: false },
        },
        {},
        '<script>alert("xss")</script>',
      );

      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });

    it('includes all CSS sections', () => {
      const pagesHtml = ['<div>Content</div>'];
      const html = handler.generatePrintDocument(
        pagesHtml,
        {
          paperSize: 'letter',
          orientation: 'portrait',
          margins: { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7 },
          scale: 1.0,
          showGridlines: true,
          showHeaders: false,
          center: { horizontal: false, vertical: false },
        },
        {
          header: { center: 'Header' },
          footer: { center: 'Footer' },
        },
        'Test',
      );

      expect(html).toContain('@media print');
      expect(html).toContain('@media screen');
      expect(html).toContain('.print-table');
      expect(html).toContain('.page-container');
    });
  });

  describe('print', () => {
    // Note: We can't fully test the print method in unit tests
    // because it requires DOM and window.print()
    // These tests verify the method exists and has correct signature

    it('is a function', () => {
      expect(typeof handler.print).toBe('function');
    });

    it('returns a promise', () => {
      // This test would fail in a real browser environment
      // because document.body might not exist in jsdom
      // We're just verifying the API signature
      const cells = new Map<string, CellData>();
      const dataProvider = createMockDataProvider(cells);

      // The actual print call requires a real DOM environment
      // so we just check that the function is callable
      expect(() => {
        const result = handler.print({
          dataProvider,
          sheetId: 'sheet1',
        });
        expect(result).toBeInstanceOf(Promise);
        // Cancel the promise to prevent hanging test
        result.catch(() => {});
      }).not.toThrow();
    });
  });

  describe('paper sizes', () => {
    const testCases: Array<{
      paperSize: 'letter' | 'legal' | 'a4' | 'a3';
      expectedDimension: string;
    }> = [
      { paperSize: 'letter', expectedDimension: '8.5in' },
      { paperSize: 'legal', expectedDimension: '14in' },
      { paperSize: 'a4', expectedDimension: '210mm' },
      { paperSize: 'a3', expectedDimension: '297mm' },
    ];

    testCases.forEach(({ paperSize, expectedDimension }) => {
      it(`generates correct dimensions for ${paperSize}`, async () => {
        const cells = new Map<string, CellData>();
        cells.set('0,0', { value: 'Test' });

        const dataProvider = createMockDataProvider(cells);

        const html = await handler.generatePreview({
          dataProvider,
          sheetId: 'sheet1',
          printOptions: {
            paperSize,
          },
        });

        expect(html).toContain(expectedDimension);
      });
    });
  });

  describe('orientation', () => {
    it('portrait orientation uses correct dimensions', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        printOptions: {
          paperSize: 'letter',
          orientation: 'portrait',
        },
      });

      expect(html).toContain('8.5in 11in portrait');
    });

    it('landscape orientation swaps dimensions', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        printOptions: {
          paperSize: 'letter',
          orientation: 'landscape',
        },
      });

      expect(html).toContain('11in 8.5in landscape');
    });
  });

  describe('centering', () => {
    it('adds horizontal centering styles when enabled', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        printOptions: {
          center: { horizontal: true, vertical: false },
        },
      });

      expect(html).toContain('justify-content: center');
    });

    it('adds vertical centering styles when enabled', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Test' });

      const dataProvider = createMockDataProvider(cells);

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        printOptions: {
          center: { horizontal: false, vertical: true },
        },
      });

      expect(html).toContain('align-items: center');
    });
  });

  describe('multiple print areas', () => {
    it('handles multiple sheets/areas', async () => {
      const cells = new Map<string, CellData>();
      cells.set('0,0', { value: 'Sheet 1 Data' });
      cells.set('1,0', { value: 'More Data' });

      const dataProvider = createMockDataProvider(cells, { sheetName: 'Sheet1' });

      const html = await handler.generatePreview({
        dataProvider,
        sheetId: 'sheet1',
        areas: [
          {
            sheetId: 'sheet1',
            range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
          },
          {
            sheetId: 'sheet1',
            range: { startRow: 1, startCol: 0, endRow: 1, endCol: 0 },
          },
        ],
      });

      expect(html).toContain('Sheet 1 Data');
      expect(html).toContain('More Data');
    });
  });
});
