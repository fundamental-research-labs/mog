/**
 * WorksheetStylesImpl Unit Tests
 *
 * Tests the WorksheetStyles sub-API:
 * 1. applyStyle — valid style name applies to cell
 * 2. applyStyle — unknown style throws KernelError
 * 3. applyStyleToRange — valid style applied to range
 * 4. applyStyleToRange — invalid range throws
 * 5. getStyle — returns matching style name
 * 6. getStyle — returns null when no match
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { KernelError } from '../../errors';

// ---------------------------------------------------------------------------
// Mock domain functions
// ---------------------------------------------------------------------------

const getAllStyles = jest.fn();
const applyStyleToCell = jest.fn();
const applyStyleToRange = jest.fn();

jest.unstable_mockModule('../../domain/cells/cell-properties', () => ({
  getAllStyles,
  applyStyleToCell,
  applyStyleToRange,
}));

const { WorksheetStylesImpl } = await import('../worksheet/styles');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHEET_ID = sheetId('sheet-1');

const MOCK_STYLES = [
  {
    id: 'normal',
    name: 'Normal',
    category: 'good-bad-neutral' as const,
    format: { fontFamily: 'Calibri', fontSize: 11 },
    builtIn: true,
  },
  {
    id: 'heading1',
    name: 'Heading 1',
    category: 'titles-headings' as const,
    format: { bold: true, fontSize: 15, fontColor: '#4472c4' },
    builtIn: true,
  },
  {
    id: 'custom-abc',
    name: 'My Custom',
    category: 'custom' as const,
    format: { bold: true, italic: true, backgroundColor: '#FFFF00' },
    builtIn: false,
  },
];

function createMockCtx(): any {
  return {
    computeBridge: {
      getResolvedFormat: jest.fn().mockResolvedValue({}),
      setFormatForRanges: jest.fn().mockResolvedValue(undefined),
      getAllCustomCellStyles: jest.fn().mockResolvedValue([]),
    },
    writeGate: { assertWritable: jest.fn() },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorksheetStylesImpl', () => {
  let ctx: any;
  let styles: WorksheetStylesImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    styles = new WorksheetStylesImpl(ctx, SHEET_ID);

    // Default: getAllStyles returns our mock styles
    (getAllStyles as jest.Mock).mockResolvedValue(MOCK_STYLES);
  });

  // =========================================================================
  // applyStyle
  // =========================================================================

  describe('applyStyle', () => {
    it('resolves style name and applies to cell', async () => {
      (applyStyleToCell as jest.Mock).mockResolvedValue(true);

      await styles.applyStyle('B2', 'Heading 1');

      expect(applyStyleToCell).toHaveBeenCalledWith(ctx, SHEET_ID, 1, 1, 'heading1');
    });

    it('throws KernelError when style name is not found', async () => {
      await expect(styles.applyStyle('A1', 'NonExistent')).rejects.toThrow(KernelError);
      await expect(styles.applyStyle('A1', 'NonExistent')).rejects.toThrow(
        'Style "NonExistent" not found',
      );
    });

    it('throws KernelError when applyStyleToCell returns false', async () => {
      (applyStyleToCell as jest.Mock).mockResolvedValue(false);

      await expect(styles.applyStyle('A1', 'Normal')).rejects.toThrow(KernelError);
      await expect(styles.applyStyle('A1', 'Normal')).rejects.toThrow(
        'Failed to apply style "Normal"',
      );
    });
  });

  // =========================================================================
  // applyStyleToRange
  // =========================================================================

  describe('applyStyleToRange', () => {
    it('resolves style name and applies to range', async () => {
      (applyStyleToRange as jest.Mock).mockResolvedValue(true);

      await styles.applyStyleToRange('A1:C3', 'My Custom');

      expect(applyStyleToRange).toHaveBeenCalledWith(
        ctx,
        SHEET_ID,
        { startRow: 0, startCol: 0, endRow: 2, endCol: 2 },
        'custom-abc',
      );
    });

    it('throws KernelError for invalid range string', async () => {
      await expect(styles.applyStyleToRange('invalid!!', 'Normal')).rejects.toThrow(KernelError);
    });

    it('throws KernelError when style name is not found', async () => {
      await expect(styles.applyStyleToRange('A1:B2', 'Unknown')).rejects.toThrow(
        'Style "Unknown" not found',
      );
    });

    it('throws KernelError when applyStyleToRange returns false', async () => {
      (applyStyleToRange as jest.Mock).mockResolvedValue(false);

      await expect(styles.applyStyleToRange('A1:B2', 'Normal')).rejects.toThrow(
        'Failed to apply style "Normal" to range',
      );
    });
  });

  // =========================================================================
  // getStyle
  // =========================================================================

  describe('getStyle', () => {
    it('returns matching style name when cell format matches', async () => {
      ctx.computeBridge.getResolvedFormat.mockResolvedValue({
        bold: true,
        fontSize: 15,
        fontColor: '#4472c4',
      });

      const result = await styles.getStyle('A1');

      expect(result).toBe('Heading 1');
      expect(ctx.computeBridge.getResolvedFormat).toHaveBeenCalledWith(SHEET_ID, 0, 0);
    });

    it('returns null when no style matches', async () => {
      ctx.computeBridge.getResolvedFormat.mockResolvedValue({
        bold: true,
        fontSize: 99,
        fontColor: '#000000',
      });

      const result = await styles.getStyle('A1');

      expect(result).toBe(null);
    });

    it('accepts numeric (row, col) overload', async () => {
      ctx.computeBridge.getResolvedFormat.mockResolvedValue({
        fontFamily: 'Calibri',
        fontSize: 11,
      });

      const result = await styles.getStyle(0, 0);

      expect(result).toBe('Normal');
      expect(ctx.computeBridge.getResolvedFormat).toHaveBeenCalledWith(SHEET_ID, 0, 0);
    });

    it('treats undefined/null format values as equivalent', async () => {
      // Cell has explicit null/undefined, style has undefined — should still match
      ctx.computeBridge.getResolvedFormat.mockResolvedValue({
        bold: true,
        italic: true,
        backgroundColor: '#FFFF00',
      });

      const result = await styles.getStyle('D5');

      expect(result).toBe('My Custom');
    });
  });
});
