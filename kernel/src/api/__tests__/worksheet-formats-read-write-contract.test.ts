import { jest } from '@jest/globals';

import type { CellFormat, ResolvedCellFormat, SheetId } from '@mog-sdk/contracts/core';
import { sheetId } from '@mog-sdk/contracts/core';
import type { WorksheetFormats } from '@mog-sdk/contracts/api';
import { WorksheetFormatsImpl } from '../worksheet/formats';

const SHEET_ID = sheetId('sheet-format-roundtrip');

/**
 * Exhaustive public read shape. This intentionally does not include the Rust
 * transport name `quotePrefix`: the public spelling is `forcedTextMode`.
 * `numberFormatType` is derived, while `extensions` is durable format state.
 */
const PUBLIC_RESOLVED_FORMAT_KEYS = {
  numberFormat: true,
  numberFormatType: true,
  fontFamily: true,
  fontSize: true,
  fontTheme: true,
  fontColor: true,
  fontColorTint: true,
  fontCharset: true,
  fontFamilyType: true,
  bold: true,
  italic: true,
  underlineType: true,
  strikethrough: true,
  superscript: true,
  subscript: true,
  fontOutline: true,
  fontShadow: true,
  horizontalAlign: true,
  verticalAlign: true,
  wrapText: true,
  indent: true,
  textRotation: true,
  shrinkToFit: true,
  readingOrder: true,
  autoIndent: true,
  backgroundColor: true,
  backgroundColorTint: true,
  patternType: true,
  patternForegroundColor: true,
  patternForegroundColorTint: true,
  gradientFill: true,
  borders: true,
  locked: true,
  hidden: true,
  forcedTextMode: true,
  pivotButton: true,
  extensions: true,
} as const;

type MissingResolvedKeys = Exclude<
  keyof ResolvedCellFormat,
  keyof typeof PUBLIC_RESOLVED_FORMAT_KEYS
>;
type ExtraResolvedKeys = Exclude<
  keyof typeof PUBLIC_RESOLVED_FORMAT_KEYS,
  keyof ResolvedCellFormat
>;
const RESOLVED_KEYS_ARE_EXACT: [MissingResolvedKeys, ExtraResolvedKeys] extends [never, never]
  ? true
  : never = true;
void RESOLVED_KEYS_ARE_EXACT;

const RUST_RESOLVED_FORMAT = {
  fontFamily: 'Aptos',
  fontSize: 11,
  fontColor: 'theme:accent1',
  fontColorTint: null,
  bold: false,
  italic: false,
  underlineType: 'none',
  strikethrough: false,
  superscript: null,
  subscript: null,
  fontOutline: null,
  fontShadow: null,
  fontTheme: 'minor',
  fontCharset: 128,
  fontFamilyType: 2,
  horizontalAlign: 'general',
  verticalAlign: 'bottom',
  wrapText: false,
  indent: null,
  textRotation: null,
  shrinkToFit: null,
  readingOrder: null,
  autoIndent: null,
  numberFormat: '0.00%',
  backgroundColor: null,
  backgroundColorTint: null,
  patternType: null,
  patternForegroundColor: null,
  patternForegroundColorTint: null,
  gradientFill: null,
  borders: null,
  locked: true,
  hidden: false,
  quotePrefix: true,
  pivotButton: true,
  extensions: { ignoreError: true, 'test.owner': 'format-contract' },
} as const;

const PUBLIC_RESOLVED_FORMAT = {
  numberFormat: '0.00%',
  numberFormatType: 'percentage',
  fontFamily: 'Aptos',
  fontSize: 11,
  fontTheme: 'minor',
  fontColor: 'theme:accent1',
  fontColorTint: null,
  fontCharset: 128,
  fontFamilyType: 2,
  bold: false,
  italic: false,
  underlineType: 'none',
  strikethrough: false,
  superscript: null,
  subscript: null,
  fontOutline: null,
  fontShadow: null,
  horizontalAlign: 'general',
  verticalAlign: 'bottom',
  wrapText: false,
  indent: null,
  textRotation: null,
  shrinkToFit: null,
  readingOrder: null,
  autoIndent: null,
  backgroundColor: null,
  backgroundColorTint: null,
  patternType: null,
  patternForegroundColor: null,
  patternForegroundColorTint: null,
  gradientFill: null,
  borders: null,
  locked: true,
  hidden: false,
  forcedTextMode: true,
  pivotButton: true,
  extensions: { ignoreError: true, 'test.owner': 'format-contract' },
} as const satisfies ResolvedCellFormat;

const PUBLIC_SPARSE_FORMAT = {
  numberFormat: '0.00%',
  numberFormatType: 'percentage',
  fontColor: 'theme:accent1',
  fontCharset: 128,
  fontFamilyType: 2,
  forcedTextMode: true,
  pivotButton: true,
  extensions: { ignoreError: true },
} as const;

const EXPECTED_CLEAR_FIELDS = [
  'fontColorTint',
  'superscript',
  'subscript',
  'fontOutline',
  'fontShadow',
  'indent',
  'textRotation',
  'shrinkToFit',
  'readingOrder',
  'autoIndent',
  'backgroundColor',
  'backgroundColorTint',
  'patternType',
  'patternForegroundColor',
  'patternForegroundColorTint',
  'gradientFill',
  'borders',
] as const;

function createMockCtx(): any {
  return {
    writeGate: { assertWritable: jest.fn() },
    computeBridge: {
      canDoStructureOp: jest.fn().mockResolvedValue(true),
      getTransferableFormat: jest.fn().mockResolvedValue({ ...RUST_RESOLVED_FORMAT }),
      getResolvedFormat: jest.fn().mockResolvedValue({ ...RUST_RESOLVED_FORMAT }),
      getDisplayedCellProperties: jest.fn().mockResolvedValue({
        ...RUST_RESOLVED_FORMAT,
        fontColor: '#4472C4',
        backgroundColor: '#FFF2CC',
      }),
      getDisplayedRangeProperties: jest.fn().mockResolvedValue([
        [
          {
            ...RUST_RESOLVED_FORMAT,
            fontColor: '#4472C4',
            backgroundColor: '#FFF2CC',
          },
        ],
      ]),
      queryRangeProperties: jest.fn().mockResolvedValue([[{ ...RUST_RESOLVED_FORMAT }]]),
      getRowFormats: jest.fn().mockResolvedValue([[2, { ...RUST_RESOLVED_FORMAT }]]),
      getColFormats: jest.fn().mockResolvedValue([[3, { ...RUST_RESOLVED_FORMAT }]]),
      patchFormatForRanges: jest.fn().mockResolvedValue({ propertyChanges: [{}] }),
      patchRowFormat: jest.fn().mockResolvedValue({}),
      patchColFormat: jest.fn().mockResolvedValue({}),
      patchCellPropertiesBatch: jest.fn().mockResolvedValue({}),
      patchRowFormats: jest.fn().mockResolvedValue({}),
      patchColFormats: jest.fn().mockResolvedValue({}),
    },
  };
}

function expectPublicShape(format: Record<string, unknown>): void {
  expect(Object.keys(format).sort()).toEqual(Object.keys(PUBLIC_RESOLVED_FORMAT_KEYS).sort());
  expect(format).toEqual(PUBLIC_RESOLVED_FORMAT);
  expect(format).not.toHaveProperty('quotePrefix');
}

function expectCanonicalPatch(wireFormat: Record<string, unknown>, clearFields: string[]): void {
  expect(wireFormat).toMatchObject({
    fontCharset: 128,
    fontFamilyType: 2,
    quotePrefix: true,
    pivotButton: true,
    extensions: { ignoreError: true, 'test.owner': 'format-contract' },
  });
  expect(wireFormat).not.toHaveProperty('forcedTextMode');
  expect(wireFormat).not.toHaveProperty('numberFormatType');
  for (const key of EXPECTED_CLEAR_FIELDS) {
    expect(wireFormat).not.toHaveProperty(key);
  }
  expect([...clearFields].sort()).toEqual([...EXPECTED_CLEAR_FIELDS].sort());
}

/**
 * Compile-time public contract: every read surface can feed its corresponding
 * write surface without casts or `any`.
 */
async function getThenSetTypeFixture(formats: WorksheetFormats, sheet: SheetId): Promise<void> {
  const resolved = await formats.get('A1');
  await formats.set('B1', resolved);
  await formats.set(0, 1, resolved);
  await formats.setRange('C1:D2', resolved);
  await formats.setRange(
    { sheetId: sheet, startRow: 0, startCol: 2, endRow: 1, endCol: 3 },
    resolved,
  );
  await formats.setRanges(
    [{ sheetId: sheet, startRow: 0, startCol: 4, endRow: 1, endCol: 5 }],
    resolved,
  );
  await formats.applyPattern(resolved, null, {
    sheetId: sheet,
    startRow: 0,
    startCol: 6,
    endRow: 1,
    endCol: 7,
  });

  const cells = await formats.getCellProperties('A1');
  if (cells[0]?.[0]) {
    await formats.setCellProperties([{ row: 0, col: 8, format: cells[0][0] }]);
  }

  const rows = await formats.getRowProperties([0]);
  await formats.setRowProperties(rows);

  const columns = await formats.getColumnProperties([0]);
  await formats.setColumnProperties(columns);
}
void getThenSetTypeFixture;

describe('WorksheetFormats public read/write contract', () => {
  let ctx: any;
  let formats: WorksheetFormatsImpl;

  beforeEach(() => {
    ctx = createMockCtx();
    formats = new WorksheetFormatsImpl(ctx, SHEET_ID);
  });

  it('returns exactly the canonical dense public keys with symbolic theme refs and no raw names', async () => {
    const format = await formats.get('A1');
    const formatByCoordinates = await formats.get(0, 0);

    expectPublicShape(format as unknown as Record<string, unknown>);
    expectPublicShape(formatByCoordinates as unknown as Record<string, unknown>);
    expect(ctx.computeBridge.getTransferableFormat).toHaveBeenCalledTimes(2);
    expect(ctx.computeBridge.getTransferableFormat).toHaveBeenNthCalledWith(1, SHEET_ID, 0, 0);
    expect(ctx.computeBridge.getTransferableFormat).toHaveBeenNthCalledWith(2, SHEET_ID, 0, 0);
    expect(ctx.computeBridge.getResolvedFormat).not.toHaveBeenCalled();
    expect(format.fontColor).toBe('theme:accent1');
    expect(format.numberFormatType).toBe('percentage');
  });

  it('keeps rendered theme resolution and display overlays on the displayed-format surface only', async () => {
    const transferable = await formats.get('A1');
    const displayed = await formats.getDisplayedCellProperties('A1');
    const displayedByCoordinates = await formats.getDisplayedCellProperties(0, 0);
    const displayedRangeByA1 = await formats.getDisplayedRangeProperties('A1');
    const displayedRangeByObject = await formats.getDisplayedRangeProperties({
      sheetId: SHEET_ID,
      startRow: 0,
      startCol: 0,
      endRow: 0,
      endCol: 0,
    });

    expect(transferable.fontColor).toBe('theme:accent1');
    expect(transferable.backgroundColor).toBeNull();
    for (const rendered of [
      displayed,
      displayedByCoordinates,
      displayedRangeByA1[0]![0]!,
      displayedRangeByObject[0]![0]!,
    ]) {
      expect(rendered.fontColor).toBe('#4472C4');
      expect(rendered.backgroundColor).toBe('#FFF2CC');
      expect(rendered.forcedTextMode).toBe(true);
      expect(rendered).not.toHaveProperty('quotePrefix');
    }
  });

  it('accepts its own get result and retains null clears, fidelity fields, forced-text mapping, and extensions', async () => {
    const format = await formats.get('A1');
    await expect(formats.set('B1', format)).resolves.toEqual({ cellCount: 1 });

    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenCalledWith(
      SHEET_ID,
      [[0, 1, 0, 1]],
      expect.any(Object),
      expect.any(Array),
      expect.any(Object),
    );
    const wireFormat = ctx.computeBridge.patchFormatForRanges.mock.calls[0][2];
    const clearFields = ctx.computeBridge.patchFormatForRanges.mock.calls[0][3];
    expectCanonicalPatch(wireFormat, clearFields);
  });

  it('transfers a supplied borders value as one complete top-level property', async () => {
    const sourceBorders = {
      bottom: { style: 'dashed', color: '#112233' },
    } as const;
    const targetBorders = {
      top: { style: 'thin', color: '#445566' },
    } as const;
    ctx.computeBridge.getTransferableFormat
      .mockResolvedValueOnce({ ...RUST_RESOLVED_FORMAT, borders: sourceBorders })
      .mockResolvedValueOnce({ ...RUST_RESOLVED_FORMAT, borders: targetBorders });

    const source = await formats.get('A1');
    const targetBefore = await formats.get('B1');
    expect(source.borders).toEqual(sourceBorders);
    expect(targetBefore.borders).toEqual(targetBorders);

    await formats.set('B1', source);

    const wireFormat = ctx.computeBridge.patchFormatForRanges.mock.calls[0][2];
    const clearFields = ctx.computeBridge.patchFormatForRanges.mock.calls[0][3];
    expect(wireFormat.borders).toEqual(sourceBorders);
    expect(wireFormat.borders).not.toHaveProperty('top');
    expect(clearFields).not.toContain('borders');
  });

  it('accepts readback through range, pattern, cell, row, and column setter variants', async () => {
    const format = await formats.get('A1');
    await formats.set(7, 1, format);
    await formats.setRange('B1:C2', format);
    await formats.setRange(
      { sheetId: SHEET_ID, startRow: 1, startCol: 4, endRow: 2, endCol: 5 },
      format,
    );
    await formats.setRanges(
      [{ sheetId: SHEET_ID, startRow: 3, startCol: 1, endRow: 4, endCol: 2 }],
      format,
    );
    await formats.setRanges(
      [
        {
          sheetId: SHEET_ID,
          startRow: 0,
          startCol: 6,
          endRow: 0,
          endCol: 6,
          isFullColumn: true,
        },
        {
          sheetId: SHEET_ID,
          startRow: 8,
          startCol: 0,
          endRow: 8,
          endCol: 0,
          isFullRow: true,
        },
        { sheetId: SHEET_ID, startRow: 9, startCol: 1, endRow: 9, endCol: 2 },
      ],
      format,
    );
    await formats.applyPattern(format, null, {
      sheetId: SHEET_ID,
      startRow: 5,
      startCol: 1,
      endRow: 6,
      endCol: 2,
    });

    const cells = await formats.getCellProperties('A1');
    await formats.setCellProperties([{ row: 7, col: 1, format: cells[0]![0]! }]);

    const rows = await formats.getRowProperties([2]);
    await formats.setRowProperties(rows);

    const columns = await formats.getColumnProperties([3]);
    await formats.setColumnProperties(columns);

    expect(ctx.computeBridge.patchFormatForRanges).toHaveBeenCalledTimes(6);
    expect(ctx.computeBridge.patchRowFormat).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.patchColFormat).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.patchCellPropertiesBatch).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.patchRowFormats).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.patchColFormats).toHaveBeenCalledTimes(1);

    for (const call of ctx.computeBridge.patchFormatForRanges.mock.calls) {
      expectCanonicalPatch(call[2], call[3]);
    }
    for (const call of ctx.computeBridge.patchRowFormat.mock.calls) {
      expectCanonicalPatch(call[2], call[3]);
    }
    for (const call of ctx.computeBridge.patchColFormat.mock.calls) {
      expectCanonicalPatch(call[2], call[3]);
    }
    for (const call of ctx.computeBridge.patchCellPropertiesBatch.mock.calls) {
      for (const tuple of call[1]) {
        expectCanonicalPatch(tuple[2], tuple[3]);
      }
    }
    for (const call of ctx.computeBridge.patchRowFormats.mock.calls) {
      for (const tuple of call[1]) {
        expectCanonicalPatch(tuple[1], tuple[2]);
      }
    }
    for (const call of ctx.computeBridge.patchColFormats.mock.calls) {
      for (const tuple of call[1]) {
        expectCanonicalPatch(tuple[1], tuple[2]);
      }
    }
  });

  it('projects sparse cell, row, and column getters to canonical names before writeback', async () => {
    const cells = await formats.getCellProperties('A1');
    const rows = await formats.getRowProperties([2]);
    const columns = await formats.getColumnProperties([3]);

    for (const format of [cells[0]![0]!, rows.get(2)!, columns.get(3)!]) {
      expect(format).toMatchObject(PUBLIC_SPARSE_FORMAT);
      expect(format).not.toHaveProperty('quotePrefix');
    }
  });

  it('validates derived numberFormatType, strips a consistent companion, and rejects silent inputs', async () => {
    await expect(formats.getNumberFormatCategory('A1')).resolves.toBe('percentage');

    await expect(
      formats.set('A1', { numberFormat: '0.00%', numberFormatType: 'percentage' }),
    ).resolves.toEqual({ cellCount: 1 });
    expect(ctx.computeBridge.patchFormatForRanges.mock.calls[0][2]).toEqual({
      numberFormat: '0.00%',
    });

    await expect(
      formats.set('A2', { numberFormatType: 'percentage' } as CellFormat),
    ).rejects.toThrow(/numberFormatType.*numberFormat/i);
    await expect(
      formats.set('A3', { numberFormat: '0.00%', numberFormatType: 'currency' }),
    ).rejects.toThrow(/numberFormatType.*percentage/i);
  });
});
