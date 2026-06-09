import type { CellFormat } from '@mog-sdk/contracts/core';
import type { ResolvedSheetViewSkin } from '@mog-sdk/contracts/rendering/sheet-view-skin';
import { resolveCellTextColor } from '@mog/spreadsheet-utils/cells/cell-style';

type EditorDisplayFormat = Pick<CellFormat, 'backgroundColor' | 'fontColor'>;

export interface InlineEditorDisplayColors {
  backgroundColor: string;
  textColor: string;
}

export function resolveInlineEditorDisplayColors(
  format: EditorDisplayFormat | undefined,
  skin: ResolvedSheetViewSkin,
): InlineEditorDisplayColors {
  return {
    backgroundColor: format?.backgroundColor ?? skin.defaultCellBackground,
    textColor: resolveCellTextColor(format, skin.defaultCellText),
  };
}
