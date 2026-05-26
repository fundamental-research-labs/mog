/**
 * Table Engine — Pure computation for tables, structured references, filters, slicers, sort, and styles.
 *
 * Stateless. Position-based. Immutable. No DOM, no Yjs, no React.
 * Bridge owns caching, CellId translation, and EventBus integration.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════

export type {
  BorderDef,
  CellRange,
  CellValue,
  ConditionFilter,
  DynamicFilter,
  DynamicFilterRule,
  FilterCondition,
  FilterCriteria,
  FilterDropdownData,
  FilterDropdownItem,
  FilterOperator,
  // Filter
  FilterState,
  // Row Visibility
  RowVisibility,
  // Slicer
  Slicer,
  SlicerCache,
  SlicerCacheItem,
  // Sort
  SortSpec,
  SpecialItem,
  // Structured References
  StructuredRef,
  StructuredRefSpecifier,
  // Table
  Table,
  // Table Styles
  TableCellFormat,
  TableColumn,
  TableStructureChange,
  TableStyleDef,
  TableStyleId,
  TopBottomFilter,
  TotalsFunction,
  ValueFilter,
} from './types';

// ═══════════════════════════════════════════
//  TABLE MODEL
// ═══════════════════════════════════════════

export {
  addColumn,
  createTable,
  generateTableName,
  getColumnAtGridCol,
  getColumnById,
  getColumnByName,
  getColumnDataRange,
  getDataRange,
  getHeaderRange,
  getTotalsFormula,
  getTotalsRange,
  isInDataRange,
  isInHeaderRow,
  isInTable,
  isInTotalsRow,
  removeColumn,
  renameColumn,
  resizeTable,
  setTableOption,
  setTotalsFunction,
  tablesOverlap,
  toggleTotalsRow,
  validateTableName,
} from './table';

// ═══════════════════════════════════════════
//  STRUCTURED REFERENCES
// ═══════════════════════════════════════════

export {
  adjustStructuredRef,
  formatStructuredRef,
  parseStructuredRef,
  resolveStructuredRef,
} from './structured-refs';

// ═══════════════════════════════════════════
//  FILTER ENGINE
// ═══════════════════════════════════════════

export {
  clearAllFilters,
  clearColumnFilter,
  createFilterState,
  evaluateColumnFilter,
  setColumnFilter,
} from './filter';

export {
  cellValueKey,
  cellValuesEqual,
  compareValues,
  formatCellDisplay,
  getCellErrorValue,
  isBlank,
  isCellError,
  valueInList,
} from './compare';

export { buildFilterDropdownData } from './filter-dropdown';

export { evaluateTopBottomDirect, resolveDynamicFilter } from './filter-resolve';

// ═══════════════════════════════════════════
//  CONTRACTS CONVERSION
// ═══════════════════════════════════════════

export { convertContractsFilter } from './convert';

// ═══════════════════════════════════════════
//  SORT
// ═══════════════════════════════════════════

export { computeSortOrder } from './sort';

// ═══════════════════════════════════════════
//  SLICER
// ═══════════════════════════════════════════

export {
  clearSlicerSelection,
  createSlicer,
  selectAllSlicerValues,
  setSlicerSelection,
  slicerToFilterCriteria,
  toggleSlicerValue,
} from './slicer';

export { buildSlicerCache } from './slicer-cache';

// ═══════════════════════════════════════════
//  ROW VISIBILITY PRIMITIVES
// ═══════════════════════════════════════════

export { composeBitmaps, createRowVisibility } from './visibility';

// ═══════════════════════════════════════════
//  TABLE STYLES
// ═══════════════════════════════════════════

export { getBuiltInTableStyles, resolveTableCellFormat } from './styles';

// ═══════════════════════════════════════════
//  WASM BACKEND
// ═══════════════════════════════════════════

export { hasWasm, initTableWasm } from './wasm-backend';
export type { TableWasmExports } from './wasm-backend';
