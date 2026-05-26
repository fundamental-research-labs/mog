import { SHEET_META_SCHEMA } from '../domain/sheets/sheet-meta-defaults';

export interface SheetMetaPageBreakDefault {
  readonly id: number;
  readonly min: number;
  readonly max: number;
  readonly manual: boolean;
  readonly pt: boolean;
}

export interface SheetMetaDefaults {
  readonly defaultRowHeight: number;
  readonly defaultColWidth: number;
  readonly frozenRows: number;
  readonly frozenCols: number;
  readonly tabColor: string | null;
  readonly hidden: boolean;
  readonly showGridlines: boolean;
  readonly showRowHeaders: boolean;
  readonly showColumnHeaders: boolean;
  readonly isProtected: boolean;
  readonly showZeroValues: boolean;
  readonly gridlineColor: string;
  readonly rightToLeft: boolean;
  readonly showFormulas: boolean;
  readonly rowPageBreaks: readonly SheetMetaPageBreakDefault[];
  readonly colPageBreaks: readonly SheetMetaPageBreakDefault[];
  readonly printArea: null;
  readonly printTitles: null;
  readonly splitConfig: null;
  readonly usedRange: null;
}

export function createSheetMetaDefaults(): SheetMetaDefaults {
  return {
    defaultRowHeight: SHEET_META_SCHEMA.defaultRowHeight.default,
    defaultColWidth: SHEET_META_SCHEMA.defaultColWidth.default,
    frozenRows: SHEET_META_SCHEMA.frozenRows.default,
    frozenCols: SHEET_META_SCHEMA.frozenCols.default,
    tabColor: SHEET_META_SCHEMA.tabColor.default,
    hidden: SHEET_META_SCHEMA.hidden.default,
    showGridlines: SHEET_META_SCHEMA.showGridlines.default,
    showRowHeaders: SHEET_META_SCHEMA.showRowHeaders.default,
    showColumnHeaders: SHEET_META_SCHEMA.showColumnHeaders.default,
    isProtected: SHEET_META_SCHEMA.isProtected.default,
    showZeroValues: SHEET_META_SCHEMA.showZeroValues.default,
    gridlineColor: SHEET_META_SCHEMA.gridlineColor.default,
    rightToLeft: SHEET_META_SCHEMA.rightToLeft.default,
    showFormulas: SHEET_META_SCHEMA.showFormulas.default,
    rowPageBreaks: SHEET_META_SCHEMA.rowPageBreaks.default.map((pageBreak) => ({ ...pageBreak })),
    colPageBreaks: SHEET_META_SCHEMA.colPageBreaks.default.map((pageBreak) => ({ ...pageBreak })),
    printArea: SHEET_META_SCHEMA.printArea.default,
    printTitles: SHEET_META_SCHEMA.printTitles.default,
    splitConfig: SHEET_META_SCHEMA.splitConfig.default,
    usedRange: SHEET_META_SCHEMA.usedRange.default,
  };
}
