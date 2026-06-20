/**
 * Mutation Receipt Types
 *
 * Typed receipts returned by pull-path mutations. Instead of returning just
 * an ID or void, mutations return rich typed data that downstream consumers
 * (rendering, selection, undo) can use without re-querying.
 */

import type { ObjectBounds } from '../kernel/floating-object-manager';
import type { CellRange, CellValue, SheetId } from '@mog/types-core/core';
import type { WorksheetRange } from './ranges';
import type { CFRule, ConditionalFormat } from '@mog/types-formatting/conditional-format/rules';
import type { Chart, SeriesConfig, TrendlineConfig } from '@mog/types-data/data/charts';
import type { FloatingObject } from '@mog/types-objects/objects/floating-objects';
import type { OperationReceiptBase } from './operation-receipt';
import type { AutoFillApplyReceipt } from './worksheet/fill';
import type {
  ChartAppModel,
  ChartAxisRole,
  ChartSourceBindingChange,
  ChartSourceBindingAppModel,
} from '@mog/types-data/data/chart-app-model';
import type {
  ApplyScenarioResult,
  Comment,
  LinkId,
  LinkStatusView,
  PivotQueryResult,
  Slicer,
  TableInfo,
  TableUpdateOptions,
} from './receipt-payloads';
import type {
  CalculatedFieldId,
  PivotCommandReceipt,
  PivotFieldArea,
  PivotFieldPlacementFlat,
  PivotKernelMutationReceipt,
  PivotPlacementMutationReceipt,
  PlacementId,
  PivotReadbackRevision,
  PivotTableConfig,
  PivotTableResult,
} from '@mog/types-data/data/pivot';

export type {
  OperationDiagnostic,
  OperationDiagnosticTarget,
  OperationEffect,
  OperationEffectMapping,
  OperationEffectType,
  OperationReceiptBase,
  OperationStatus,
} from './operation-receipt';

export type {
  PivotCommandReceipt,
  PivotKernelMutationReceipt,
  PivotMutationEffect,
  PivotMutationStatus,
  PivotPlacementMutationReceipt,
  PivotReadbackRevision,
} from '@mog/types-data/data/pivot';

// =============================================================================
// Floating Objects
// =============================================================================

export interface FloatingObjectReceiptBase extends OperationReceiptBase {
  readonly kind: 'floatingObject.create' | 'floatingObject.update' | 'floatingObject.remove';
  readonly sheetId: string;
}

/** Receipt for a floating object creation or update mutation. */
export interface FloatingObjectMutationReceipt extends FloatingObjectReceiptBase {
  readonly domain: 'floatingObject';
  readonly action: 'create' | 'update';
  readonly id: string;
  readonly object: FloatingObject;
  readonly bounds: ObjectBounds;
}

/** Receipt for a floating object removal mutation. */
export interface FloatingObjectRemoveReceipt extends FloatingObjectReceiptBase {
  readonly domain: 'floatingObject';
  readonly action: 'remove';
  readonly id: string;
}

export type FloatingObjectReceipt = FloatingObjectMutationReceipt | FloatingObjectRemoveReceipt;
export type FloatingObjectHandleMutationReceipt<THandle extends object> =
  FloatingObjectMutationReceipt & THandle & { readonly handle: THandle };

/**
 * @deprecated Use `FloatingObjectRemoveReceipt` instead.
 */
export type FloatingObjectDeleteReceipt = FloatingObjectRemoveReceipt;

export function isFloatingObjectReceipt(
  receipt: MutationReceipt,
): receipt is FloatingObjectReceipt {
  return 'domain' in receipt && receipt.domain === 'floatingObject';
}

export function isFloatingObjectMutationReceipt(
  receipt: MutationReceipt,
): receipt is FloatingObjectMutationReceipt {
  return (
    isFloatingObjectReceipt(receipt) && (receipt.action === 'create' || receipt.action === 'update')
  );
}

export function isFloatingObjectRemoveReceipt(
  receipt: MutationReceipt,
): receipt is FloatingObjectRemoveReceipt {
  return isFloatingObjectReceipt(receipt) && receipt.action === 'remove';
}

// =============================================================================
// Charts
// =============================================================================

/** Receipt for creating a chart. */
export interface ChartAddReceipt extends OperationReceiptBase {
  readonly kind: 'chart.add';
  readonly status: 'applied';
  readonly chart: Chart;
}

/** Receipt for updating a chart. */
export interface ChartUpdateReceipt extends OperationReceiptBase {
  readonly kind: 'chart.update';
  readonly status: 'applied';
  readonly chart: Chart;
  readonly changedFields: readonly string[];
}

/** Receipt for removing a chart. */
export interface ChartRemoveReceipt extends OperationReceiptBase {
  readonly kind: 'chart.remove';
  readonly status: 'applied';
  readonly chartId: string;
}

/** Receipt for duplicating a chart. */
export interface ChartDuplicateReceipt extends OperationReceiptBase {
  readonly kind: 'chart.duplicate';
  readonly status: 'applied';
  readonly sourceChartId: string;
  readonly chart: Chart;
}

/** Receipt for activating/selecting a chart. */
export interface ChartActivateReceipt extends OperationReceiptBase {
  readonly kind: 'chart.activate';
  readonly status: 'applied';
  readonly chartId: string;
}

export type ChartCoreMutationReceipt =
  | ChartAddReceipt
  | ChartUpdateReceipt
  | ChartRemoveReceipt
  | ChartDuplicateReceipt
  | ChartActivateReceipt;

export type ChartMutationReceiptKind =
  | 'chart.series.add'
  | 'chart.series.update'
  | 'chart.series.remove'
  | 'chart.series.reorder'
  | 'chart.series.setValues'
  | 'chart.series.setCategories'
  | 'chart.series.setBubbleSizes'
  | 'chart.series.setBinOptions'
  | 'chart.series.setBoxwhiskerOptions'
  | 'chart.point.format'
  | 'chart.point.setDataLabel'
  | 'chart.trendline.add'
  | 'chart.trendline.update'
  | 'chart.trendline.remove'
  | 'chart.legend.setVisible'
  | 'chart.axis.setVisible'
  | 'chart.axis.setTitle'
  | 'chart.title.setVisible'
  | 'chart.source.switchSeriesOrientation'
  | 'chart.categoryNames.set'
  | 'chart.dataLabel.setHeight'
  | 'chart.dataLabel.setWidth';

/** Receipt for chart series, trendline, axis, and data-label mutations. */
export interface ChartSeriesMutationReceipt extends OperationReceiptBase {
  readonly kind: ChartMutationReceiptKind;
  readonly status: 'applied' | 'failed' | 'noOp' | 'unsupported';
  readonly sheetId: string;
  readonly chartId: string;
  readonly chart?: Chart | null;
  readonly appModelBefore?: ChartAppModel;
  readonly appModelAfter?: ChartAppModel;
  readonly sourceBindingBefore?: ChartSourceBindingAppModel;
  readonly sourceBindingAfter?: ChartSourceBindingAppModel;
  readonly sourceBindingChange?: ChartSourceBindingChange;
  readonly seriesIndex?: number;
  readonly fromSeriesIndex?: number;
  readonly toSeriesIndex?: number;
  readonly trendlineIndex?: number;
  readonly pointIndex?: number;
  readonly axisType?: 'category' | 'value';
  readonly axisRole?: ChartAxisRole;
  readonly range?: string;
  readonly visible?: boolean;
  readonly title?: string | null;
  readonly series?: SeriesConfig | null;
  readonly trendline?: TrendlineConfig | null;
}

export type ChartMutationReceipt = ChartCoreMutationReceipt | ChartSeriesMutationReceipt;

// =============================================================================
// Structure Mutations
// =============================================================================

/** Receipt for an insertRows mutation. */
export interface InsertRowsReceipt {
  readonly kind: 'insertRows';
  readonly sheetId: string;
  readonly insertedAt: number;
  readonly count: number;
}

/** Receipt for a deleteRows mutation. */
export interface DeleteRowsReceipt {
  readonly kind: 'deleteRows';
  readonly sheetId: string;
  readonly deletedAt: number;
  readonly count: number;
}

/** Receipt for an insertColumns mutation. */
export interface InsertColumnsReceipt {
  readonly kind: 'insertColumns';
  readonly sheetId: string;
  readonly insertedAt: number;
  readonly count: number;
}

/** Receipt for a deleteColumns mutation. */
export interface DeleteColumnsReceipt {
  readonly kind: 'deleteColumns';
  readonly sheetId: string;
  readonly deletedAt: number;
  readonly count: number;
}

/** Receipt for an insertCellsWithShift mutation. */
export interface InsertCellsReceipt {
  readonly kind: 'insertCells';
  readonly sheetId: string;
  readonly range: { startRow: number; startCol: number; endRow: number; endCol: number };
  readonly direction: 'right' | 'down';
}

/** Receipt for a deleteCellsWithShift mutation. */
export interface DeleteCellsReceipt {
  readonly kind: 'deleteCells';
  readonly sheetId: string;
  readonly range: { startRow: number; startCol: number; endRow: number; endCol: number };
  readonly direction: 'left' | 'up';
}

// =============================================================================
// Sheet Management
// =============================================================================

/** Receipt for a sheet remove mutation. */
export interface SheetRemoveReceipt {
  readonly kind: 'sheetRemove';
  readonly removedName: string;
  readonly remainingCount: number;
}

/** Receipt for a sheet rename mutation. */
export interface SheetRenameReceipt {
  readonly kind: 'sheetRename';
  readonly oldName: string;
  readonly newName: string;
}

/** Receipt for a sheet move mutation. */
export interface SheetMoveReceipt {
  readonly kind: 'sheetMove';
  readonly name: string;
  readonly newIndex: number;
}

/** Receipt for a sheet hide mutation. */
export interface SheetHideReceipt {
  readonly kind: 'sheetHide';
  readonly name: string;
}

/** Receipt for a sheet show mutation. */
export interface SheetShowReceipt {
  readonly kind: 'sheetShow';
  readonly name: string;
}

// =============================================================================
// Merge Operations
// =============================================================================

/** Receipt for a merge mutation. */
export interface MergeReceipt {
  readonly kind: 'merge';
  readonly range: string;
}

/** Receipt for an unmerge mutation. */
export interface UnmergeReceipt {
  readonly kind: 'unmerge';
  readonly range: string;
}

// =============================================================================
// Table Mutations
// =============================================================================

/** Receipt for a table creation mutation. */
export interface TableAddReceipt extends OperationReceiptBase {
  readonly kind: 'tableAdd';
  readonly status: 'applied';
  readonly tableId: string;
  readonly name: string;
  readonly range: string;
  readonly table: TableInfo;
}

/** Receipt for a table remove mutation. */
export interface TableRemoveReceipt extends OperationReceiptBase {
  readonly kind: 'tableRemove';
  readonly status: 'applied';
  readonly tableId: string;
  readonly tableName: string;
  readonly range: string;
  readonly table: TableInfo;
}

/** Receipt for converting a table back to a plain range. */
export interface TableConvertToRangeReceipt extends OperationReceiptBase {
  readonly kind: 'tableConvertToRange';
  readonly status: 'applied';
  readonly tableId: string;
  readonly tableName: string;
  readonly range: string;
  readonly table: TableInfo;
  readonly affectedFormulaCount: number;
}

/** Receipt for removing all table definitions on a worksheet. */
export interface TableClearReceipt extends OperationReceiptBase {
  readonly kind: 'tableClear';
  readonly status: 'applied' | 'noOp';
  readonly sheetId: string;
  readonly removedCount: number;
  readonly tableIds: readonly string[];
  readonly tables: readonly TableInfo[];
}

/** Receipt for a table rename mutation. */
export interface TableRenameReceipt extends OperationReceiptBase {
  readonly kind: 'tableRename';
  readonly status: 'applied' | 'noOp';
  readonly tableId: string;
  readonly tableName: string;
  readonly oldName: string;
  readonly newName: string;
  readonly name: string;
  readonly range: string;
}

/** Receipt for a table property update mutation. */
export interface TableUpdateReceipt extends OperationReceiptBase {
  readonly kind: 'tableUpdate';
  readonly status: 'applied' | 'noOp';
  readonly tableId: string;
  readonly tableName: string;
  readonly range: string;
  readonly updates: TableUpdateOptions;
}

/** Receipt for a table resize mutation. */
export interface TableResizeReceipt extends OperationReceiptBase {
  readonly kind: 'tableResize';
  readonly status: 'applied' | 'noOp';
  readonly tableId: string;
  readonly tableName: string;
  readonly oldRange: string;
  readonly newRange: string;
  readonly range: string;
}

/** Receipt for a table addColumn mutation. */
export interface TableAddColumnReceipt extends OperationReceiptBase {
  readonly kind: 'tableAddColumn';
  readonly status: 'applied';
  readonly tableId: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly position: number;
  readonly range: string;
}

/** Receipt for a table removeColumn mutation. */
export interface TableRemoveColumnReceipt extends OperationReceiptBase {
  readonly kind: 'tableRemoveColumn';
  readonly status: 'applied';
  readonly tableId: string;
  readonly tableName: string;
  readonly columnIndex: number;
  readonly columnName: string;
  readonly range: string;
}

/** Receipt for a table column rename mutation. */
export interface TableRenameColumnReceipt extends OperationReceiptBase {
  readonly kind: 'tableRenameColumn';
  readonly status: 'applied' | 'noOp';
  readonly tableId: string;
  readonly tableName: string;
  readonly columnIndex: number;
  readonly oldColumnName: string;
  readonly newColumnName: string;
  readonly range: string;
}

/** Receipt for a table addRow mutation. */
export interface TableAddRowReceipt extends OperationReceiptBase {
  readonly kind: 'tableAddRow';
  readonly status: 'applied';
  readonly tableId: string;
  readonly tableName: string;
  readonly index: number;
  readonly range: string;
}

/** Receipt for a table deleteRow mutation. */
export interface TableDeleteRowReceipt extends OperationReceiptBase {
  readonly kind: 'tableDeleteRow';
  readonly status: 'applied';
  readonly tableId: string;
  readonly tableName: string;
  readonly index: number;
  readonly range: string;
}

interface TableCalculatedColumnReceiptBase extends OperationReceiptBase {
  readonly status: 'applied' | 'noOp' | 'partial' | 'failed';
  readonly tableName: string;
  readonly tableId: string;
  readonly columnIndex: number;
  readonly columnName?: string;
  readonly tableRange: string;
  readonly bodyRange: string | null;
  readonly columnRange: string | null;
  readonly cellsWritten: number;
  readonly metadataChanged: boolean;
  readonly undoGroup: boolean;
}

/** Receipt for setting a table calculated-column formula. */
export interface TableSetCalculatedColumnReceipt extends TableCalculatedColumnReceiptBase {
  readonly kind: 'table.calculatedColumn.set';
  readonly action: 'set';
  readonly formula: string;
  readonly autofillReceipt?: AutoFillApplyReceipt;
}

/** Receipt for clearing a table calculated-column formula. */
export interface TableClearCalculatedColumnReceipt extends TableCalculatedColumnReceiptBase {
  readonly kind: 'table.calculatedColumn.clear';
  readonly action: 'clear';
  readonly formula: null;
}

export type TableCalculatedColumnReceipt =
  | TableSetCalculatedColumnReceipt
  | TableClearCalculatedColumnReceipt;

export type TableAutoExpansionStatus = 'applied' | 'noOp' | 'unsupported' | 'partial' | 'failed';

export type TableAutoExpansionUnsupportedReason =
  | 'protectedRegion'
  | 'filteredRegion'
  | 'mergedRegion';

/** Receipt for applying table auto-expansion. */
export interface TableAutoExpansionReceipt extends OperationReceiptBase {
  readonly kind: 'tableAutoExpansion';
  readonly status: TableAutoExpansionStatus;
  readonly sheetId: string;
  readonly tableName: string;
  readonly tableId?: string;
  readonly previousRange?: string;
  readonly expectedRange?: string;
  readonly newRange?: string;
  readonly changedTableMetadata: boolean;
  readonly changedCellCount: number;
  readonly unsupportedReasons: readonly TableAutoExpansionUnsupportedReason[];
}

// =============================================================================
// Named Ranges
// =============================================================================

export interface NameReceiptItem {
  readonly id: string;
  readonly name: string;
  readonly reference: string;
  readonly scope?: string;
  readonly scopeSheetId?: SheetId;
  readonly comment?: string;
  readonly visible?: boolean;
}

/** Receipt for a named range add mutation. */
export interface NameAddReceipt extends OperationReceiptBase {
  readonly kind: 'nameAdd';
  readonly status: 'applied';
  readonly name: string;
  readonly reference: string;
  readonly created: NameReceiptItem;
}

/** Receipt for a named range remove mutation. */
export interface NameRemoveReceipt extends OperationReceiptBase {
  readonly kind: 'nameRemove';
  readonly status: 'applied';
  readonly name: string;
  readonly removed: NameReceiptItem;
}

/** Receipt for a named range update mutation. */
export interface NameUpdateReceipt extends OperationReceiptBase {
  readonly kind: 'nameUpdate';
  readonly status: 'applied' | 'noOp';
  readonly name: string;
  readonly previous: NameReceiptItem;
  readonly updated: NameReceiptItem;
}

/** Receipt for clearing named ranges. */
export interface NameClearReceipt extends OperationReceiptBase {
  readonly kind: 'nameClear';
  readonly status: 'applied' | 'noOp';
  readonly removed: readonly NameReceiptItem[];
  readonly removedCount: number;
}

// =============================================================================
// Filters
// =============================================================================

/** Receipt for setting an auto-filter. */
export interface AutoFilterSetReceipt extends OperationReceiptBase {
  readonly kind: 'autoFilterSet';
  readonly status: 'applied';
  readonly range: string;
}

/** Receipt for clearing an auto-filter. */
export interface AutoFilterClearReceipt extends OperationReceiptBase {
  readonly kind: 'autoFilterClear';
  readonly status: 'applied' | 'noOp';
  readonly clearedCount: number;
}

export type FilterMutationKind =
  | 'filter.columnFilter.set'
  | 'filter.dynamicFilter.apply'
  | 'filter.columnFilter.clear'
  | 'filter.criteria.clearAll'
  | 'filter.apply'
  | 'filter.reapply';

export type FilterMutationStatus = 'applied' | 'noOp' | 'unsupported' | 'failed';

/** Receipt for criteria and projection mutations on an existing worksheet filter. */
export interface FilterMutationReceipt extends OperationReceiptBase {
  readonly kind: FilterMutationKind;
  readonly status: FilterMutationStatus;
  readonly sheetId: string;
  readonly filterId?: string;
  readonly filterKind?: 'autoFilter' | 'tableFilter' | 'advancedFilter' | (string & {});
  readonly tableId?: string;
  readonly range?: string;
  readonly column?: number;
  readonly hiddenRowCount?: number;
  readonly visibleRowCount?: number;
  readonly unsupportedReasons?: readonly string[];
  readonly hasActiveFilter?: boolean;
  readonly clearable?: boolean;
}

// =============================================================================
// Validation
// =============================================================================

export interface ValidationReceiptTarget {
  readonly id?: string;
  readonly address?: string;
  readonly ranges: readonly string[];
}

export interface ValidationRemovalPayload {
  readonly address?: string;
  readonly ids: readonly string[];
  readonly ranges: readonly string[];
  readonly count: number;
}

/** Receipt for setting a validation rule. */
export interface ValidationSetReceipt extends OperationReceiptBase {
  readonly kind: 'validationSet';
  readonly status: 'applied';
  readonly address: string;
  readonly validation: ValidationReceiptTarget;
}

/** Receipt for removing a validation rule. */
export interface ValidationRemoveReceipt extends OperationReceiptBase {
  readonly kind: 'validationRemove';
  readonly status: 'applied' | 'noOp';
  readonly address: string;
  readonly removed: ValidationRemovalPayload;
}

/** Receipt for clearing validation rules from a sheet or range. */
export interface ValidationClearReceipt extends OperationReceiptBase {
  readonly kind: 'validationClear';
  readonly status: 'applied' | 'noOp';
  readonly address?: string;
  readonly removed: ValidationRemovalPayload;
}

// =============================================================================
// Comments
// =============================================================================

/** Cell or range affected by a comment mutation. */
export interface CommentMutationTarget {
  readonly sheetId: string;
  readonly address?: string;
  readonly range?: string;
  readonly row?: number;
  readonly col?: number;
  readonly cellRef?: string;
}

/** Details for an implicit note-to-thread conversion performed by a comment mutation. */
export interface CommentConversionEffect {
  readonly commentId: string;
  readonly from: 'note';
  readonly to: 'threadedComment';
  readonly comment: Comment;
  readonly target?: CommentMutationTarget;
}

/** Receipt for creating a comment, note, or reply. */
export interface CommentAddReceipt extends OperationReceiptBase {
  readonly kind: 'comment.add' | 'comment.addNote' | 'comment.addReply';
  readonly status: 'applied';
  readonly sheetId: string;
  readonly id: string;
  readonly commentId: string;
  readonly threadId: string | null;
  readonly parentId?: string | null;
  readonly target: CommentMutationTarget;
  readonly comment: Comment;
  readonly conversion?: CommentConversionEffect;
  readonly removedCommentIds?: readonly string[];
  readonly removedCount?: number;
}

/** Receipt for updating comment, note, thread, or conversion state. */
export interface CommentUpdateReceipt extends OperationReceiptBase {
  readonly kind:
    | 'comment.update'
    | 'comment.updateNote'
    | 'comment.resolveThread'
    | 'comment.convertNoteToThread';
  readonly status: 'applied' | 'noOp';
  readonly sheetId: string;
  readonly commentId?: string;
  readonly threadId?: string | null;
  readonly target?: CommentMutationTarget;
  readonly comment?: Comment;
  readonly comments?: readonly Comment[];
  readonly commentIds?: readonly string[];
  readonly resolved?: boolean;
  readonly conversion?: CommentConversionEffect;
}

/** Receipt for removing comments or clearing comment collections. */
export interface CommentRemoveReceipt extends OperationReceiptBase {
  readonly kind: 'comment.remove' | 'comment.removeNote' | 'comment.clear';
  readonly status: 'applied' | 'noOp';
  readonly sheetId: string;
  readonly commentId?: string;
  readonly threadId?: string | null;
  readonly target?: CommentMutationTarget;
  readonly removedCount: number;
  readonly removedCommentIds: readonly string[];
  readonly comments?: readonly Comment[];
}

export type CommentReceipt = CommentAddReceipt | CommentUpdateReceipt | CommentRemoveReceipt;

// =============================================================================
// Conditional Formatting
// =============================================================================

export type ConditionalFormatMutationKind =
  | 'conditionalFormat.add'
  | 'conditionalFormat.addFormula'
  | 'conditionalFormat.update'
  | 'conditionalFormat.clearRuleStyle'
  | 'conditionalFormat.changeRuleType'
  | 'conditionalFormat.remove'
  | 'conditionalFormat.removeRule'
  | 'conditionalFormat.clear'
  | 'conditionalFormat.clearInRanges'
  | 'conditionalFormat.reorder'
  | 'conditionalFormat.cloneForPaste';

/** Receipt for conditional-format mutations. */
export interface ConditionalFormatMutationReceipt extends OperationReceiptBase {
  readonly kind: ConditionalFormatMutationKind;
  readonly status: 'applied' | 'noOp';
  readonly sheetId: string;
  readonly formatIds: readonly string[];
  readonly ruleIds: readonly string[];
  readonly ranges: readonly CellRange[];
  readonly formatCount: number;
  readonly ruleCount: number;
  readonly format?: ConditionalFormat | null;
  readonly formats?: readonly ConditionalFormat[];
  readonly rules?: readonly CFRule[];
  readonly requestedRanges?: readonly CellRange[];
}

// =============================================================================
// History
// =============================================================================

/** Receipt for an undo operation. */
export interface UndoReceipt {
  readonly kind: 'undo';
  readonly success: boolean;
}

/** Receipt for a redo operation. */
export interface RedoReceipt {
  readonly kind: 'redo';
  readonly success: boolean;
}

// =============================================================================
// Workbook Lifecycle Operations
// =============================================================================

/** Receipt for refreshing one workbook external link status. */
export interface WorkbookLinkRefreshReceipt extends OperationReceiptBase {
  readonly kind: 'workbook.links.refresh';
  readonly status: 'applied' | 'partial' | 'failed' | 'unsupported';
  readonly linkId: LinkId;
  readonly statusView: LinkStatusView;
}

/** Aggregate receipt for refreshing all workbook external links. */
export interface WorkbookLinksRefreshAllReceipt extends OperationReceiptBase {
  readonly kind: 'workbook.links.refreshAll';
  readonly status: 'applied' | 'noOp' | 'partial' | 'failed' | 'unsupported';
  readonly linkIds: readonly LinkId[];
  readonly statusViews: readonly LinkStatusView[];
  readonly receipts: readonly WorkbookLinkRefreshReceipt[];
  readonly refreshedCount: number;
  readonly failedCount: number;
  readonly unsupportedCount: number;
}

/** Successful receipt for applying a workbook what-if scenario. */
export interface WorkbookScenarioApplySuccessReceipt
  extends OperationReceiptBase, ApplyScenarioResult {
  readonly kind: 'workbook.scenarios.apply';
  readonly status: 'applied' | 'noOp' | 'partial';
  readonly scenarioId: string;
  readonly result: ApplyScenarioResult;
}

/** Failed receipt for applying a workbook what-if scenario. */
export interface WorkbookScenarioApplyFailureReceipt extends OperationReceiptBase {
  readonly kind: 'workbook.scenarios.apply';
  readonly status: 'failed';
  readonly scenarioId: string;
  readonly result: null;
}

export type WorkbookScenarioApplyReceipt =
  | WorkbookScenarioApplySuccessReceipt
  | WorkbookScenarioApplyFailureReceipt;

export interface ViewportRefreshBounds {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
}

export type ViewportRefreshReason =
  | 'smartSkip'
  | 'prefetchHit'
  | 'fullFetch'
  | 'deltaFetch'
  | 'superseded';

/** Details returned by the viewport movement refresh pipeline. */
export interface ViewportRefreshDetails {
  readonly viewportId: string;
  readonly sheetId: string;
  readonly visibleBounds: ViewportRefreshBounds;
  readonly prefetchBounds: ViewportRefreshBounds | null;
  readonly scrollBehavior: string;
  readonly fetched: boolean;
  readonly cacheHit: boolean;
  readonly delta: boolean;
  readonly projectionChanged: boolean;
  readonly superseded: boolean;
  readonly reason: ViewportRefreshReason | (string & {});
}

/** Receipt for refreshing one registered viewport region. */
export interface ViewportRegionRefreshReceipt extends OperationReceiptBase {
  readonly kind: 'viewport.refresh';
  readonly status: 'applied' | 'noOp' | 'cancelled' | 'failed';
  readonly regionId: string;
  readonly sheetId: string;
  readonly bounds: ViewportRefreshBounds;
  readonly details?: ViewportRefreshDetails;
}

// =============================================================================
// Pivots
// =============================================================================

export type PivotCreationLifecycle = 'defineOnly' | 'materialize';

/** Receipt for defining or materializing a pivot table on an existing sheet. */
export interface PivotAddReceipt extends OperationReceiptBase {
  readonly kind: 'pivot.add';
  readonly status: 'applied' | 'partial' | 'failed';
  readonly pivotId: string;
  readonly config: PivotTableConfig;
  readonly lifecycle: PivotCreationLifecycle;
  readonly materialized: boolean;
  readonly renderedRange?: WorksheetRange | null;
  readonly result?: PivotTableResult | null;
}

/** Receipt for atomically creating a sheet and defining/materializing a pivot. */
export interface PivotAddWithSheetReceipt extends OperationReceiptBase {
  readonly kind: 'pivot.addWithSheet';
  readonly status: 'applied' | 'partial' | 'failed';
  readonly sheetId: string;
  readonly pivotId: string;
  readonly config: PivotTableConfig;
  readonly lifecycle: PivotCreationLifecycle;
  readonly materialized: boolean;
  readonly renderedRange?: WorksheetRange | null;
  readonly result?: PivotTableResult | null;
}

/** Receipt for a pivot table refresh/materialization mutation. */
export interface PivotRefreshReceipt extends OperationReceiptBase {
  readonly kind: 'pivot.refresh';
  readonly status: 'applied' | 'failed' | 'cancelled' | 'timedOut';
  readonly pivotId: string;
  readonly config?: PivotTableConfig | null;
  readonly materialized: boolean;
  readonly renderedRange?: WorksheetRange | null;
  readonly result?: PivotTableResult | null;
}

/** Receipt for computing a pivot table without mutating worksheet state. */
export interface PivotComputeReceipt extends OperationReceiptBase {
  readonly kind: 'pivot.compute';
  readonly status: 'completed' | 'failed' | 'unsupported';
  readonly sheetId: string;
  readonly pivotId: string;
  readonly result: PivotTableResult | null;
}

/** Receipt for querying a pivot table without mutating worksheet state. */
export interface PivotQueryReceipt extends OperationReceiptBase {
  readonly kind: 'pivot.query';
  readonly status: 'completed' | 'failed' | 'unsupported';
  readonly sheetId: string;
  readonly pivotId: string;
  readonly result: PivotQueryResult | null;
}

/** Aggregate receipt for refreshing/materializing every pivot on a worksheet. */
export interface PivotRefreshAllReceipt extends OperationReceiptBase {
  readonly kind: 'pivot.refreshAll';
  readonly status: 'applied' | 'noOp' | 'partial' | 'failed';
  readonly sheetId: string;
  readonly pivotIds: readonly string[];
  readonly receipts: readonly PivotRefreshReceipt[];
  readonly materialized: boolean;
  readonly materializedCount: number;
  readonly failedCount: number;
  readonly renderedRanges: readonly (WorksheetRange | null)[];
}

export type PivotHandleMutationKind =
  | 'pivot.handle.update'
  | 'pivot.handle.delete'
  | 'pivot.handle.addField'
  | 'pivot.handle.addValueField'
  | 'pivot.handle.addPlacement'
  | 'pivot.handle.removeField'
  | 'pivot.handle.removePlacement'
  | 'pivot.handle.moveField'
  | 'pivot.handle.movePlacement'
  | 'pivot.handle.changeAggregation'
  | 'pivot.handle.setPlacementAggregateFunction'
  | 'pivot.handle.renameValueField'
  | 'pivot.handle.renameValuePlacement'
  | 'pivot.handle.setShowValuesAs'
  | 'pivot.handle.setSortOrder'
  | 'pivot.handle.setPlacementSortOrder'
  | 'pivot.handle.setSortByValue'
  | 'pivot.handle.setFilter'
  | 'pivot.handle.removeFilter'
  | 'pivot.handle.setLayout'
  | 'pivot.handle.setStyle'
  | 'pivot.handle.toggleExpanded'
  | 'pivot.handle.setAllExpanded'
  | 'pivot.handle.addCalculatedField'
  | 'pivot.handle.setItemVisibility'
  | 'pivot.handle.setDataSource';

export type PivotHandleMutationStatus = 'applied' | 'noOp' | 'failed';

/** Receipt for mutating an existing pivot table through a bound handle. */
export interface PivotHandleMutationReceipt extends OperationReceiptBase {
  readonly kind: PivotHandleMutationKind;
  readonly status: PivotHandleMutationStatus;
  readonly sheetId: string;
  readonly pivotId: string;
  readonly config?: PivotTableConfig;
  readonly fieldId?: string;
  readonly area?: PivotFieldArea;
  readonly placementId?: PlacementId;
  readonly placement?: PivotFieldPlacementFlat;
  readonly calculatedFieldId?: CalculatedFieldId;
  readonly deleted?: boolean;
  readonly expanded?: boolean;
  readonly kernelReceipt?:
    | PivotKernelMutationReceipt
    | PivotPlacementMutationReceipt
    | PivotCommandReceipt;
}

export interface PivotHandleCalculatedFieldReceipt extends PivotHandleMutationReceipt {
  readonly kind: 'pivot.handle.addCalculatedField';
  readonly calculatedFieldId: CalculatedFieldId;
  readonly kernelReceipt: PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId };
}

export interface PivotHandleDeleteReceipt extends PivotHandleMutationReceipt {
  readonly kind: 'pivot.handle.delete';
  readonly deleted: boolean;
}

export interface PivotHandleExpansionReceipt extends PivotHandleMutationReceipt {
  readonly kind: 'pivot.handle.toggleExpanded' | 'pivot.handle.setAllExpanded';
  readonly expanded: boolean;
}

export interface PivotWorksheetMutationReceiptBase extends OperationReceiptBase {
  readonly status: 'applied' | 'noOp' | 'failed';
  readonly sheetId: string;
  readonly pivotId?: string;
  readonly pivotName?: string;
  readonly config?: PivotTableConfig | null;
  readonly kernelReceipt?: PivotKernelMutationReceipt;
}

export interface PivotAddFieldReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.addField';
  readonly placementId?: PlacementId;
}

export interface PivotMoveFieldReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.moveField';
  readonly placementId?: PlacementId;
}

export interface PivotRemoveFieldReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.removeField';
  readonly placementId?: PlacementId;
}

export interface PivotResetFieldReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.resetField';
}

export interface PivotAddCalculatedFieldReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.addCalculatedField';
  readonly calculatedFieldId?: CalculatedFieldId;
}

export interface PivotRemoveCalculatedFieldReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.removeCalculatedField';
  readonly calculatedFieldId?: CalculatedFieldId;
}

/** Receipt for a pivot table remove mutation. */
export interface PivotRemoveReceipt extends OperationReceiptBase {
  readonly kind: 'pivot.remove';
  readonly status: 'applied' | 'noOp' | 'failed';
  readonly sheetId: string;
  readonly pivotId?: string;
  readonly pivotName: string;
  readonly removedConfig?: PivotTableConfig | null;
}

export interface PivotClearReceipt extends OperationReceiptBase {
  readonly kind: 'pivot.clear';
  readonly status: 'applied' | 'noOp' | 'partial' | 'failed';
  readonly sheetId: string;
  readonly pivotIds: readonly string[];
  readonly removedCount: number;
  readonly failedCount: number;
  readonly receipts: readonly PivotRemoveReceipt[];
}

export interface PivotRenameReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.rename';
  readonly oldName: string;
  readonly newName: string;
}

export interface PivotSetFilterReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.setFilter';
}

export interface PivotRemoveFilterReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.removeFilter';
}

export interface PivotSetPivotItemVisibilityReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.setPivotItemVisibility';
}

export interface PivotSetItemVisibilityReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.setItemVisibility';
}

export interface PivotSetAllExpandedReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.setAllExpanded';
  readonly expanded: boolean;
}

export interface PivotSetDataSourceReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.setDataSource';
  readonly dataSource: string;
}

export interface PivotSetAutoFormatReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.setAutoFormat';
  readonly autoFormat: boolean;
}

export interface PivotSetPreserveFormattingReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.setPreserveFormatting';
  readonly preserveFormatting: boolean;
}

export interface PivotSetAllowMultipleFiltersPerFieldReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.setAllowMultipleFiltersPerField';
  readonly allowMultipleFiltersPerField: boolean;
}

export interface PivotSetEnableMultipleFilterItemsReceipt extends PivotWorksheetMutationReceiptBase {
  readonly kind: 'pivot.setEnableMultipleFilterItems';
  readonly fieldId: string;
  readonly enableMultipleFilterItems: boolean;
}

export type PivotWorksheetMutationReceipt =
  | PivotAddFieldReceipt
  | PivotMoveFieldReceipt
  | PivotRemoveFieldReceipt
  | PivotResetFieldReceipt
  | PivotAddCalculatedFieldReceipt
  | PivotRemoveCalculatedFieldReceipt
  | PivotRemoveReceipt
  | PivotClearReceipt
  | PivotRenameReceipt
  | PivotSetFilterReceipt
  | PivotRemoveFilterReceipt
  | PivotSetPivotItemVisibilityReceipt
  | PivotSetItemVisibilityReceipt
  | PivotSetAllExpandedReceipt
  | PivotSetDataSourceReceipt
  | PivotSetAutoFormatReceipt
  | PivotSetPreserveFormattingReceipt
  | PivotSetAllowMultipleFiltersPerFieldReceipt
  | PivotSetEnableMultipleFilterItemsReceipt;

// =============================================================================
// Slicers
// =============================================================================

export interface SlicerReceiptSourceFields {
  readonly sourceTableId?: string;
  readonly sourcePivotId?: string;
}

export interface SlicerAddReceipt extends OperationReceiptBase, SlicerReceiptSourceFields {
  readonly kind: 'slicer.add';
  readonly status: 'applied';
  readonly slicerId: string;
  readonly slicer: Slicer;
}

export interface SlicerUpdateReceipt extends OperationReceiptBase, SlicerReceiptSourceFields {
  readonly kind: 'slicer.update';
  readonly status: 'applied' | 'noOp';
  readonly slicerId: string;
  readonly slicer?: Slicer | null;
}

export interface SlicerRemoveReceipt extends OperationReceiptBase, SlicerReceiptSourceFields {
  readonly kind: 'slicer.remove';
  readonly status: 'applied';
  readonly slicerId: string;
  readonly slicer?: Slicer | null;
}

export interface SlicerClearReceipt extends OperationReceiptBase {
  readonly kind: 'slicer.clear';
  readonly status: 'applied' | 'noOp';
  readonly slicerIds: readonly string[];
  readonly slicers: readonly Slicer[];
  readonly removedCount: number;
}

export interface SlicerDuplicateReceipt extends OperationReceiptBase, SlicerReceiptSourceFields {
  readonly kind: 'slicer.duplicate';
  readonly status: 'applied';
  readonly slicerId: string;
  readonly sourceSlicerId: string;
  readonly slicer?: Slicer | null;
}

export interface SlicerSelectionSetReceipt extends OperationReceiptBase, SlicerReceiptSourceFields {
  readonly kind: 'slicer.selection.set';
  readonly status: 'applied';
  readonly slicerId: string;
  readonly selectedItems: readonly CellValue[];
  readonly slicer?: Slicer | null;
}

export interface SlicerSelectionClearReceipt
  extends OperationReceiptBase, SlicerReceiptSourceFields {
  readonly kind: 'slicer.selection.clear';
  readonly status: 'applied';
  readonly slicerId: string;
  readonly selectedItems: readonly [];
  readonly slicer?: Slicer | null;
}

export type SlicerSelectionReceipt = SlicerSelectionSetReceipt | SlicerSelectionClearReceipt;

export type SlicerMutationReceipt =
  | SlicerAddReceipt
  | SlicerUpdateReceipt
  | SlicerRemoveReceipt
  | SlicerClearReceipt
  | SlicerDuplicateReceipt
  | SlicerSelectionReceipt;

// =============================================================================
// Discriminated Union
// =============================================================================

/** Union of all mutation receipt types. */
export type MutationReceipt =
  | FloatingObjectMutationReceipt
  | FloatingObjectRemoveReceipt
  | ChartMutationReceipt
  | InsertRowsReceipt
  | DeleteRowsReceipt
  | InsertColumnsReceipt
  | DeleteColumnsReceipt
  | InsertCellsReceipt
  | DeleteCellsReceipt
  | SheetRemoveReceipt
  | SheetRenameReceipt
  | SheetMoveReceipt
  | SheetHideReceipt
  | SheetShowReceipt
  | MergeReceipt
  | UnmergeReceipt
  | TableAddReceipt
  | TableRemoveReceipt
  | TableConvertToRangeReceipt
  | TableClearReceipt
  | TableRenameReceipt
  | TableUpdateReceipt
  | TableResizeReceipt
  | TableAddColumnReceipt
  | TableRemoveColumnReceipt
  | TableRenameColumnReceipt
  | TableAddRowReceipt
  | TableDeleteRowReceipt
  | TableCalculatedColumnReceipt
  | TableAutoExpansionReceipt
  | NameAddReceipt
  | NameRemoveReceipt
  | NameUpdateReceipt
  | NameClearReceipt
  | AutoFilterSetReceipt
  | AutoFilterClearReceipt
  | FilterMutationReceipt
  | ValidationSetReceipt
  | ValidationRemoveReceipt
  | ValidationClearReceipt
  | CommentReceipt
  | ConditionalFormatMutationReceipt
  | UndoReceipt
  | RedoReceipt
  | PivotWorksheetMutationReceipt
  | WorkbookLinkRefreshReceipt
  | WorkbookLinksRefreshAllReceipt
  | WorkbookScenarioApplyReceipt
  | ViewportRegionRefreshReceipt
  | PivotAddReceipt
  | PivotAddWithSheetReceipt
  | PivotRefreshReceipt
  | PivotComputeReceipt
  | PivotQueryReceipt
  | PivotRefreshAllReceipt
  | SlicerMutationReceipt
  | PivotHandleMutationReceipt
  | PivotHandleCalculatedFieldReceipt
  | PivotHandleDeleteReceipt
  | PivotHandleExpansionReceipt
  | PivotKernelMutationReceipt
  | PivotPlacementMutationReceipt
  | PivotCommandReceipt;
