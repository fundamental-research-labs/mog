/**
 * TableGenerator Unit Tests
 */

import type { CellData, CellError } from '@mog-sdk/contracts/core';
import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from '@mog-sdk/contracts/rendering';
import { DEFAULT_PRINT_OPTIONS, type PrintRange } from '../src/contracts/types';
import {
  TableGenerator,
  tableGenerator,
  type ITableDataProvider,
} from '../src/html/table-generator';

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

describe('TableGenerator', () => {
  let generator: TableGenerator;

  beforeEach(() => {
    generator = new TableGenerator();
  });

  describe('generate', () => {
    it('should generate empty table for empty data', async () => {
      const cells = new Map<string, CellData>();
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
      });

      expect(result.html).toContain('<table');
      expect(result.html).toContain('</table>');
      expect(result.stats.rows).toBe(0);
      expect(result.stats.cols).toBe(0);
      expect(result.stats.cellsWithContent).toBe(0);
    });

    it('should generate table with single cell', async () => {
      const cells = new Map<string, CellData>([['0,0', { value: 'Hello' }]]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
      });

      expect(result.html).toContain('<table');
      expect(result.html).toContain('Hello');
      expect(result.html).toContain('</table>');
      expect(result.stats.rows).toBe(1);
      expect(result.stats.cols).toBe(1);
      expect(result.stats.cellsWithContent).toBe(1);
    });

    it('should generate table with multiple cells', async () => {
      const cells = new Map<string, CellData>([
        ['0,0', { value: 'A1' }],
        ['0,1', { value: 'B1' }],
        ['1,0', { value: 'A2' }],
        ['1,1', { value: 'B2' }],
      ]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
      });

      expect(result.html).toContain('A1');
      expect(result.html).toContain('B1');
      expect(result.html).toContain('A2');
      expect(result.html).toContain('B2');
      expect(result.stats.rows).toBe(2);
      expect(result.stats.cols).toBe(2);
      expect(result.stats.cellsWithContent).toBe(4);
    });

    it('should include column headers when showHeaders is true', async () => {
      const cells = new Map<string, CellData>([
        ['0,0', { value: 'Test' }],
        ['0,1', { value: 'Test2' }],
      ]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: { ...DEFAULT_PRINT_OPTIONS, showHeaders: true },
      });

      expect(result.html).toContain('<thead>');
      expect(result.html).toContain('class="col-header"');
      expect(result.html).toContain('>A<');
      expect(result.html).toContain('>B<');
    });

    it('should include row headers when showHeaders is true', async () => {
      const cells = new Map<string, CellData>([
        ['0,0', { value: 'Test' }],
        ['1,0', { value: 'Test2' }],
      ]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: { ...DEFAULT_PRINT_OPTIONS, showHeaders: true },
      });

      expect(result.html).toContain('class="row-header"');
      expect(result.html).toContain('>1<');
      expect(result.html).toContain('>2<');
    });

    it('should apply cell formatting', async () => {
      const cells = new Map<string, CellData>([
        [
          '0,0',
          {
            value: 'Styled',
            format: {
              bold: true,
              fontColor: '#FF0000',
            },
          },
        ],
      ]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
      });

      expect(result.html).toContain('font-weight: bold');
      expect(result.html).toContain('color: #FF0000');
      expect(result.stats.cellsWithFormatting).toBe(1);
    });

    it('should include column widths', async () => {
      const cells = new Map<string, CellData>([['0,0', { value: 'Test' }]]);
      const columnWidths = new Map([[0, 150]]);
      const provider = createMockDataProvider(cells, { columnWidths });

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
        includeColumnWidths: true,
      });

      expect(result.html).toContain('<colgroup>');
      expect(result.html).toContain('width: 150px');
    });

    it('should include row heights', async () => {
      const cells = new Map<string, CellData>([['0,0', { value: 'Test' }]]);
      const rowHeights = new Map([[0, 30]]);
      const provider = createMockDataProvider(cells, { rowHeights });

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
        includeRowHeights: true,
      });

      expect(result.html).toContain('height: 30px');
    });

    it('should respect custom range', async () => {
      const cells = new Map<string, CellData>([
        ['0,0', { value: 'A1' }],
        ['0,1', { value: 'B1' }],
        ['1,0', { value: 'A2' }],
        ['1,1', { value: 'B2' }],
        ['2,2', { value: 'C3' }], // Outside range
      ]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        range: { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
        printOptions: DEFAULT_PRINT_OPTIONS,
      });

      expect(result.html).toContain('A1');
      expect(result.html).toContain('B1');
      expect(result.html).toContain('A2');
      expect(result.html).toContain('B2');
      expect(result.html).not.toContain('C3');
      expect(result.stats.rows).toBe(2);
      expect(result.stats.cols).toBe(2);
    });

    it('should generate CSS stylesheet', async () => {
      const cells = new Map<string, CellData>([['0,0', { value: 'Test' }]]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
      });

      expect(result.css).toContain('.print-table');
      expect(result.css).toContain('@media print');
    });
  });

  describe('formatValue', () => {
    it('should format null as empty string', () => {
      expect(generator.formatValue(null)).toBe('');
    });

    it('should format undefined as empty string', () => {
      expect(generator.formatValue(undefined)).toBe('');
    });

    it('should format strings', () => {
      expect(generator.formatValue('Hello')).toBe('Hello');
    });

    it('should format integers', () => {
      expect(generator.formatValue(42)).toBe('42');
      expect(generator.formatValue(-10)).toBe('-10');
      expect(generator.formatValue(0)).toBe('0');
    });

    it('should format decimals', () => {
      expect(generator.formatValue(3.14159)).toBe('3.14159');
      expect(generator.formatValue(0.1 + 0.2)).toBe('0.3'); // JavaScript floating point
    });

    it('should format booleans', () => {
      expect(generator.formatValue(true)).toBe('TRUE');
      expect(generator.formatValue(false)).toBe('FALSE');
    });

    it('should format errors', () => {
      const error: CellError = { type: 'error', value: 'Div0' };
      expect(generator.formatValue(error)).toBe('#DIV/0!');
    });
  });

  describe('columnToLetter', () => {
    it('should convert single letter columns', () => {
      expect(generator.columnToLetter(0)).toBe('A');
      expect(generator.columnToLetter(1)).toBe('B');
      expect(generator.columnToLetter(25)).toBe('Z');
    });

    it('should convert double letter columns', () => {
      expect(generator.columnToLetter(26)).toBe('AA');
      expect(generator.columnToLetter(27)).toBe('AB');
      expect(generator.columnToLetter(51)).toBe('AZ');
      expect(generator.columnToLetter(52)).toBe('BA');
    });

    it('should convert triple letter columns', () => {
      expect(generator.columnToLetter(702)).toBe('AAA');
    });
  });

  describe('escapeHtml', () => {
    it('should escape ampersand', () => {
      expect(generator.escapeHtml('A & B')).toBe('A &amp; B');
    });

    it('should escape less than', () => {
      expect(generator.escapeHtml('A < B')).toBe('A &lt; B');
    });

    it('should escape greater than', () => {
      expect(generator.escapeHtml('A > B')).toBe('A &gt; B');
    });

    it('should escape double quotes', () => {
      expect(generator.escapeHtml('A "B" C')).toBe('A &quot;B&quot; C');
    });

    it('should escape single quotes', () => {
      expect(generator.escapeHtml("A 'B' C")).toBe('A &#39;B&#39; C');
    });

    it('should escape multiple characters', () => {
      expect(generator.escapeHtml('<script>alert("XSS")</script>')).toBe(
        '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;',
      );
    });

    it('should not modify safe strings', () => {
      expect(generator.escapeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('generateDocument', () => {
    it('should generate complete HTML document', async () => {
      const cells = new Map<string, CellData>([['0,0', { value: 'Test' }]]);
      const provider = createMockDataProvider(cells, { sheetName: 'My Sheet' });

      const html = await generator.generateDocument(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
      });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html>');
      expect(html).toContain('<head>');
      expect(html).toContain('<title>My Sheet</title>');
      expect(html).toContain('<style>');
      expect(html).toContain('</style>');
      expect(html).toContain('<body>');
      expect(html).toContain('<table');
      expect(html).toContain('Test');
      expect(html).toContain('</body>');
      expect(html).toContain('</html>');
    });

    it('should escape sheet name in title', async () => {
      const cells = new Map<string, CellData>();
      const provider = createMockDataProvider(cells, { sheetName: '<Script>' });

      const html = await generator.generateDocument(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
      });

      expect(html).toContain('<title>&lt;Script&gt;</title>');
    });
  });

  describe('singleton instance', () => {
    it('should export a singleton instance', () => {
      expect(tableGenerator).toBeInstanceOf(TableGenerator);
    });
  });

  describe('edge cases', () => {
    it('should handle sparse data (gaps in rows/cols)', async () => {
      const cells = new Map<string, CellData>([
        ['0,0', { value: 'A1' }],
        ['2,2', { value: 'C3' }],
      ]);
      const provider = createMockDataProvider(cells, {
        usedRange: { startRow: 0, startCol: 0, endRow: 2, endCol: 2 },
      });

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
      });

      expect(result.stats.rows).toBe(3);
      expect(result.stats.cols).toBe(3);
      expect(result.stats.cellsWithContent).toBe(2);
      expect(result.html).toContain('A1');
      expect(result.html).toContain('C3');
    });

    it('should handle cells with borders', async () => {
      const cells = new Map<string, CellData>([
        [
          '0,0',
          {
            value: 'Bordered',
            borders: {
              top: { style: 'thin', color: '#000000' },
              bottom: { style: 'thick', color: '#FF0000' },
            },
          },
        ],
      ]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
      });

      expect(result.html).toContain('border-top: 1px solid #000000');
      expect(result.html).toContain('border-bottom: 3px solid #FF0000');
      expect(result.stats.cellsWithFormatting).toBe(1);
    });

    it('should handle numeric values correctly', async () => {
      const cells = new Map<string, CellData>([
        ['0,0', { value: 1234567890 }],
        ['0,1', { value: 0.00001 }],
        ['0,2', { value: -999.99 }],
      ]);
      const provider = createMockDataProvider(cells, {
        usedRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 2 },
      });

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: DEFAULT_PRINT_OPTIONS,
      });

      expect(result.html).toContain('1234567890');
      expect(result.html).toContain('0.00001');
      expect(result.html).toContain('-999.99');
    });

    it('should handle all error types', () => {
      const errorVariants: Array<[CellError['value'], string]> = [
        ['Null', '#NULL!'],
        ['Div0', '#DIV/0!'],
        ['Value', '#VALUE!'],
        ['Ref', '#REF!'],
        ['Name', '#NAME?'],
        ['Num', '#NUM!'],
        ['Na', '#N/A'],
      ];

      for (const [variant, display] of errorVariants) {
        const error: CellError = { type: 'error', value: variant };
        expect(generator.formatValue(error)).toBe(display);
      }
    });
  });

  describe('headerVisibility', () => {
    it('should use default header dimensions when headerVisibility is not provided', async () => {
      const cells = new Map<string, CellData>([['0,0', { value: 'Test' }]]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: { ...DEFAULT_PRINT_OPTIONS, showHeaders: true },
      });

      // Should use the default ROW_HEADER_WIDTH (50px) from constants
      expect(result.html).toContain(`width: ${ROW_HEADER_WIDTH}px`);
      // CSS should contain the default header dimensions
      expect(result.css).toContain(`width: ${ROW_HEADER_WIDTH}px`);
      expect(result.css).toContain(`height: ${COL_HEADER_HEIGHT}px`);
    });

    it('should use dynamic header dimensions when headerVisibility is provided with both visible', async () => {
      const cells = new Map<string, CellData>([['0,0', { value: 'Test' }]]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: { ...DEFAULT_PRINT_OPTIONS, showHeaders: true },
        headerVisibility: {
          showRowHeaders: true,
          showColumnHeaders: true,
        },
      });

      // Should use the standard header dimensions when both are visible
      expect(result.html).toContain(`width: ${ROW_HEADER_WIDTH}px`);
      expect(result.css).toContain(`width: ${ROW_HEADER_WIDTH}px`);
      expect(result.css).toContain(`height: ${COL_HEADER_HEIGHT}px`);
    });

    it('should hide row header column when showRowHeaders is false', async () => {
      const cells = new Map<string, CellData>([['0,0', { value: 'Test' }]]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: { ...DEFAULT_PRINT_OPTIONS, showHeaders: true },
        headerVisibility: {
          showRowHeaders: false,
          showColumnHeaders: true,
        },
      });

      // Should have 0px width for row headers
      expect(result.css).toContain('width: 0px');
      expect(result.css).toContain('min-width: 0px');
      // Column header height should still be visible
      expect(result.css).toContain(`height: ${COL_HEADER_HEIGHT}px`);
    });

    it('should use 0px column header height when showColumnHeaders is false', async () => {
      const cells = new Map<string, CellData>([['0,0', { value: 'Test' }]]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: { ...DEFAULT_PRINT_OPTIONS, showHeaders: true },
        headerVisibility: {
          showRowHeaders: true,
          showColumnHeaders: false,
        },
      });

      // Row header width should still be visible
      expect(result.css).toContain(`width: ${ROW_HEADER_WIDTH}px`);
      // Column header height should be 0px
      expect(result.css).toContain('height: 0px');
    });

    it('should use 0px for both when both headers are hidden', async () => {
      const cells = new Map<string, CellData>([['0,0', { value: 'Test' }]]);
      const provider = createMockDataProvider(cells);

      const result = await generator.generate(provider, {
        sheetId: 'sheet1',
        printOptions: { ...DEFAULT_PRINT_OPTIONS, showHeaders: true },
        headerVisibility: {
          showRowHeaders: false,
          showColumnHeaders: false,
        },
      });

      // Both should be 0px
      expect(result.css).toContain('width: 0px');
      expect(result.css).toContain('min-width: 0px');
      expect(result.css).toContain('height: 0px');
    });
  });
});
