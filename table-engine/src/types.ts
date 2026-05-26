/**
 * Table Engine — Pure computation types.
 *
 * Position-based, immutable, stateless.  Bridge translates CellId ↔ positions.
 * Only dependency: CellValue and CellRange from @mog-sdk/contracts.
 */

import type { CellRange, CellValue } from '@mog-sdk/contracts';

// Re-export for convenience — consumers can import everything from table-engine
export type { CellRange, CellValue };

// ═══════════════════════════════════════════
//  TABLE
// ═══════════════════════════════════════════

// TODO: Naming alignment — table-engine uses `hasTotalsRow` while contracts
// (contracts/src/data/tables.ts) uses `hasTotalRow`. The bridge
// (kernel/src/bridges/table-bridge.ts:99) maps between them. To align with
// contracts, rename `hasTotalsRow` -> `hasTotalRow` in types.ts, styles.ts,
// table.ts, structured-refs.ts, and all table-engine test files. This is a
// cross-file rename that touches files owned by other agents, so coordinate
// before applying.

export interface Table {
  readonly id: string;
  readonly name: string;
  readonly sheetId: string;
  readonly range: CellRange;
  readonly columns: readonly TableColumn[];
  readonly hasHeaderRow: boolean;
  readonly hasTotalsRow: boolean;
  readonly style: TableStyleId;
  readonly bandedRows: boolean;
  readonly bandedColumns: boolean;
  readonly emphasizeFirstColumn: boolean;
  readonly emphasizeLastColumn: boolean;
  readonly showFilterButtons: boolean;
  readonly autoExpand: boolean;
  readonly autoCalculatedColumns: boolean;
}

export interface TableColumn {
  readonly id: string;
  readonly name: string;
  readonly index: number; // position within table (0-based)
  readonly totalsFunction: TotalsFunction | null;
  readonly totalsLabel: string | null; // custom label (e.g., "Total")
  readonly calculatedFormula?: string; // calculated column formula
}

export type TotalsFunction =
  | 'average'
  | 'count'
  | 'countNums'
  | 'max'
  | 'min'
  | 'stdDev'
  | 'sum'
  | 'var'
  | 'custom'
  | 'none';

/**
 * Built-in Excel table style IDs (67 styles).
 *
 * Note: contracts uses lowercase short forms (`'light1'`, `'medium2'`) via `TableStylePreset`.
 * The bridge (kernel/src/bridges/table-bridge.ts) maps `TableStylePreset` -> `TableStyleId`.
 *
 * The `(string & {})` arm preserves backward compatibility — callers can still pass
 * arbitrary strings (e.g., the bridge's dynamic string construction) while getting
 * autocomplete for known style IDs. Remove once all callers are migrated.
 */
export type TableStyleId =
  // Light styles (1-28)
  | 'TableStyleLight1'
  | 'TableStyleLight2'
  | 'TableStyleLight3'
  | 'TableStyleLight4'
  | 'TableStyleLight5'
  | 'TableStyleLight6'
  | 'TableStyleLight7'
  | 'TableStyleLight8'
  | 'TableStyleLight9'
  | 'TableStyleLight10'
  | 'TableStyleLight11'
  | 'TableStyleLight12'
  | 'TableStyleLight13'
  | 'TableStyleLight14'
  | 'TableStyleLight15'
  | 'TableStyleLight16'
  | 'TableStyleLight17'
  | 'TableStyleLight18'
  | 'TableStyleLight19'
  | 'TableStyleLight20'
  | 'TableStyleLight21'
  | 'TableStyleLight22'
  | 'TableStyleLight23'
  | 'TableStyleLight24'
  | 'TableStyleLight25'
  | 'TableStyleLight26'
  | 'TableStyleLight27'
  | 'TableStyleLight28'
  // Medium styles (1-28)
  | 'TableStyleMedium1'
  | 'TableStyleMedium2'
  | 'TableStyleMedium3'
  | 'TableStyleMedium4'
  | 'TableStyleMedium5'
  | 'TableStyleMedium6'
  | 'TableStyleMedium7'
  | 'TableStyleMedium8'
  | 'TableStyleMedium9'
  | 'TableStyleMedium10'
  | 'TableStyleMedium11'
  | 'TableStyleMedium12'
  | 'TableStyleMedium13'
  | 'TableStyleMedium14'
  | 'TableStyleMedium15'
  | 'TableStyleMedium16'
  | 'TableStyleMedium17'
  | 'TableStyleMedium18'
  | 'TableStyleMedium19'
  | 'TableStyleMedium20'
  | 'TableStyleMedium21'
  | 'TableStyleMedium22'
  | 'TableStyleMedium23'
  | 'TableStyleMedium24'
  | 'TableStyleMedium25'
  | 'TableStyleMedium26'
  | 'TableStyleMedium27'
  | 'TableStyleMedium28'
  // Dark styles (1-11)
  | 'TableStyleDark1'
  | 'TableStyleDark2'
  | 'TableStyleDark3'
  | 'TableStyleDark4'
  | 'TableStyleDark5'
  | 'TableStyleDark6'
  | 'TableStyleDark7'
  | 'TableStyleDark8'
  | 'TableStyleDark9'
  | 'TableStyleDark10'
  | 'TableStyleDark11'
  // Backward-compatible: accept arbitrary strings during transition period
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

// ═══════════════════════════════════════════
//  STRUCTURED REFERENCES
// ═══════════════════════════════════════════

export interface StructuredRef {
  readonly tableName: string;
  readonly specifiers: readonly StructuredRefSpecifier[];
}

export type StructuredRefSpecifier =
  | { readonly type: 'column'; readonly name: string }
  | { readonly type: 'columnRange'; readonly start: string; readonly end: string }
  | { readonly type: 'thisRow' }
  | { readonly type: 'special'; readonly item: SpecialItem };

export type SpecialItem = 'all' | 'data' | 'headers' | 'totals' | 'thisRow';

export type TableStructureChange =
  | { readonly type: 'columnRenamed'; readonly oldName: string; readonly newName: string }
  | { readonly type: 'tableRenamed'; readonly oldName: string; readonly newName: string }
  | { readonly type: 'columnRemoved'; readonly name: string }
  | { readonly type: 'columnAdded'; readonly name: string; readonly index: number }
  | { readonly type: 'tableResized'; readonly oldRange: CellRange; readonly newRange: CellRange };

// ═══════════════════════════════════════════
//  FILTER
// ═══════════════════════════════════════════

export interface FilterState {
  readonly filters: ReadonlyMap<string, FilterCriteria>; // keyed by table columnId (NOT CellId)
}

export type FilterCriteria =
  | ValueFilter
  | ConditionFilter
  | TopBottomFilter
  | DynamicFilter
  | ColorFilter;

export interface ValueFilter {
  readonly type: 'values';
  readonly included: readonly CellValue[]; // CellValue[], not serialized strings
  readonly includeBlanks: boolean;
}

export interface ConditionFilter {
  readonly type: 'condition';
  readonly conditions: readonly FilterCondition[];
  readonly logic: 'and' | 'or';
}

export interface FilterCondition {
  readonly operator: FilterOperator;
  readonly value: CellValue;
  readonly value2?: CellValue; // for 'between' / 'notBetween'
}

export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'beginsWith'
  | 'endsWith'
  | 'contains'
  | 'notContains'
  | 'between'
  | 'notBetween'
  | 'isBlank'
  | 'isNotBlank';

export interface TopBottomFilter {
  readonly type: 'topBottom';
  readonly direction: 'top' | 'bottom';
  readonly count: number;
  readonly by: 'items' | 'percent' | 'sum';
}

export interface DynamicFilter {
  readonly type: 'dynamic';
  readonly rule: DynamicFilterRule;
}

export type DynamicFilterRule =
  | 'aboveAverage'
  | 'belowAverage'
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'thisWeek'
  | 'lastWeek'
  | 'nextWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'nextMonth'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'nextQuarter'
  | 'thisYear'
  | 'lastYear'
  | 'nextYear';

export interface ColorFilter {
  readonly type: 'color';
  readonly cellColor?: string;
  readonly fontColor?: string;
}

export interface FilterDropdownData {
  readonly items: readonly FilterDropdownItem[];
  readonly hasBlank: boolean;
  readonly blankCount: number;
  readonly blankSelected: boolean;
  readonly totalRowCount: number;
}

export interface FilterDropdownItem {
  readonly value: CellValue;
  readonly displayText: string;
  readonly count: number;
  readonly selected: boolean;
}

// ═══════════════════════════════════════════
//  SORT
// ═══════════════════════════════════════════

export interface SortSpec {
  readonly columnId: string;
  readonly direction: 'ascending' | 'descending';
  readonly customOrder?: readonly CellValue[];
}

// ═══════════════════════════════════════════
//  SLICER
// ═══════════════════════════════════════════

export interface Slicer {
  readonly id: string;
  readonly name: string;
  readonly sourceType: 'table' | 'pivot';
  readonly sourceId: string;
  readonly sourceColumnId: string; // table columnId (NOT CellId)
  readonly selectedValues: readonly CellValue[]; // CellValue[], not serialized strings
  readonly multiSelect: boolean;
  readonly showItemsWithNoData: boolean;
  readonly sortOrder: 'ascending' | 'descending' | 'dataSourceOrder';
}

export interface SlicerCache {
  readonly items: readonly SlicerCacheItem[];
  readonly totalCount: number;
  readonly selectedCount: number;
}

export interface SlicerCacheItem {
  readonly value: CellValue;
  readonly displayText: string;
  readonly count: number;
  readonly selected: boolean;
  readonly hasData: boolean; // false when all rows hidden by OTHER filters
}

// ═══════════════════════════════════════════
//  ROW VISIBILITY
// ═══════════════════════════════════════════

export interface RowVisibility {
  readonly bitmap: Uint8Array; // 1 byte per data row: 1=visible, 0=hidden
  readonly visibleCount: number;
  readonly totalCount: number;
  readonly firstVisibleRow: number; // -1 if none (relative to data range start)
  readonly lastVisibleRow: number;
}

// ═══════════════════════════════════════════
//  TABLE STYLES
// ═══════════════════════════════════════════

export interface TableCellFormat {
  readonly fill?: string;
  readonly fontColor?: string;
  readonly fontBold?: boolean;
  readonly borderTop?: BorderDef;
  readonly borderBottom?: BorderDef;
  readonly borderLeft?: BorderDef;
  readonly borderRight?: BorderDef;
}

export interface BorderDef {
  readonly style: 'thin' | 'medium' | 'thick';
  readonly color: string;
}

export interface TableStyleDef {
  readonly id: TableStyleId;
  readonly name: string;
  readonly headerFill?: string;
  readonly headerFontColor?: string;
  readonly totalsFill?: string;
  readonly totalsFontColor?: string;
  readonly firstColumnFill?: string;
  readonly firstColumnFontColor?: string;
  readonly lastColumnFill?: string;
  readonly lastColumnFontColor?: string;
  readonly oddRowFill?: string;
  readonly evenRowFill?: string;
  readonly oddColFill?: string;
  readonly evenColFill?: string;
  readonly dataFontColor?: string;
  readonly borderColor?: string;
}
