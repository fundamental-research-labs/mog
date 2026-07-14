import type { ResolvedCellFormat, SheetId } from '@mog-sdk/contracts/core';
import type { WorksheetFormats } from '@mog-sdk/contracts/api';

const resolvedFormatKeys = {
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

type MissingResolvedKeys = Exclude<keyof ResolvedCellFormat, keyof typeof resolvedFormatKeys>;
type ExtraResolvedKeys = Exclude<keyof typeof resolvedFormatKeys, keyof ResolvedCellFormat>;
const resolvedKeysAreExact: [MissingResolvedKeys, ExtraResolvedKeys] extends [never, never]
  ? true
  : never = true;
void resolvedKeysAreExact;

/**
 * Public consumer fixture: every worksheet format read result is directly
 * accepted by the corresponding write API without casts.
 */
async function worksheetFormatReadWriteContract(
  formats: WorksheetFormats,
  sheetId: SheetId,
): Promise<void> {
  const resolved = await formats.get('A1');
  await formats.set('B1', resolved);
  await formats.set(0, 1, resolved);
  await formats.setRange('C1:D2', resolved);
  await formats.setRange({ sheetId, startRow: 0, startCol: 2, endRow: 1, endCol: 3 }, resolved);
  await formats.setRanges([{ sheetId, startRow: 0, startCol: 4, endRow: 1, endCol: 5 }], resolved);
  await formats.applyPattern(resolved, null, {
    sheetId,
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

void worksheetFormatReadWriteContract;
