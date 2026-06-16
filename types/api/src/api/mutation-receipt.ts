/**
 * Mutation Receipt Types
 *
 * Typed receipts returned by pull-path mutations. Instead of returning just
 * an ID or void, mutations return rich typed data that downstream consumers
 * (rendering, selection, undo) can use without re-querying.
 */

import type { ObjectBounds } from '../kernel/floating-object-manager';
import type { CellRange, CellValue, SheetId } from '@mog/types-core/core';
import type { CFRule, ConditionalFormat } from '@mog/types-formatting/conditional-format/rules';
import type { Chart, SeriesConfig, TrendlineConfig } from '@mog/types-data/data/charts';
import type { FloatingObject } from '@mog/types-objects/objects/floating-objects';
import type { OperationReceiptBase } from './operation-receipt';
import type { Comment, Slicer } from './types';
import type {
  PivotCommandReceipt,
  PivotKernelMutationReceipt,
  PivotPlacementMutationReceipt,
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

/** Receipt for a floating object creation or update mutation. */
export interface FloatingObjectMutationReceipt {
  readonly domain: 'floatingObject';
  readonly action: 'create' | 'update';
  readonly id: string;
  readonly object: FloatingObject;
  readonly bounds: ObjectBounds;
}

/** Receipt for a floating object removal mutation. */
export interface FloatingObjectRemoveReceipt {
  readonly domain: 'floatingObject';
  readonly action: 'remove';
  readonly id: string;
}

export type FloatingObjectReceipt = FloatingObjectMutationReceipt | FloatingObjectRemoveReceipt;

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
  | 'chart.axis.setTitle'
  | 'chart.categoryNames.set'
  | 'chart.dataLabel.setHeight'
  | 'chart.dataLabel.setWidth';

/** Receipt for chart series, trendline, axis, and data-label mutations. */
export interface ChartSeriesMutationReceipt extends OperationReceiptBase {
  readonly kind: ChartMutationReceiptKind;
  readonly status: 'applied' | 'failed' | 'noOp';
  readonly sheetId: string;
  readonly chartId: string;
  readonly chart?: Chart | null;
  readonly seriesIndex?: number;
  readonly fromSeriesIndex?: number;
  readonly toSeriesIndex?: number;
  readonly trendlineIndex?: number;
  readonly pointIndex?: number;
  readonly axisType?: 'category' | 'value';
  readonly range?: string;
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

/** Receipt for a table remove mutation. */
export interface TableRemoveReceipt {
  readonly kind: 'tableRemove';
  readonly tableName: string;
}

/** Receipt for a table resize mutation. */
export interface TableResizeReceipt {
  readonly kind: 'tableResize';
  readonly tableName: string;
  readonly newRange: string;
}

/** Receipt for a table addColumn mutation. */
export interface TableAddColumnReceipt {
  readonly kind: 'tableAddColumn';
  readonly tableName: string;
  readonly columnName: string;
  readonly position: number;
}

/** Receipt for a table removeColumn mutation. */
export interface TableRemoveColumnReceipt {
  readonly kind: 'tableRemoveColumn';
  readonly tableName: string;
  readonly columnIndex: number;
}

/** Receipt for a table addRow mutation. */
export interface TableAddRowReceipt {
  readonly kind: 'tableAddRow';
  readonly tableName: string;
  readonly index: number;
}

/** Receipt for a table deleteRow mutation. */
export interface TableDeleteRowReceipt {
  readonly kind: 'tableDeleteRow';
  readonly tableName: string;
  readonly index: number;
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
  readonly kind:
    | 'comment.remove'
    | 'comment.removeNote'
    | 'comment.removeForCell'
    | 'comment.clear'
    | 'comment.clean';
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
// Pivots
// =============================================================================

/** Receipt for a pivot table remove mutation. */
export interface PivotRemoveReceipt {
  readonly kind: 'pivotRemove';
  readonly name: string;
}

export type PivotCreationLifecycle = 'defineOnly' | 'materialize';

/** Receipt for defining or materializing a pivot table on an existing sheet. */
export interface PivotAddReceipt extends OperationReceiptBase {
  readonly kind: 'pivot.add';
  readonly status: 'applied' | 'partial' | 'failed';
  readonly pivotId: string;
  readonly config: PivotTableConfig;
  readonly lifecycle: PivotCreationLifecycle;
  readonly materialized: boolean;
  readonly renderedRange?: CellRange | null;
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
  readonly renderedRange?: CellRange | null;
  readonly result?: PivotTableResult | null;
}

/** Receipt for a pivot table refresh/materialization mutation. */
export interface PivotRefreshReceipt extends OperationReceiptBase {
  readonly kind: 'pivot.refresh';
  readonly status: 'applied' | 'failed' | 'cancelled' | 'timedOut';
  readonly pivotId: string;
  readonly config?: PivotTableConfig | null;
  readonly materialized: boolean;
  readonly renderedRange?: CellRange | null;
  readonly result?: PivotTableResult | null;
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
  readonly renderedRanges: readonly (CellRange | null)[];
}

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

export interface SlicerSelectionSetReceipt
  extends OperationReceiptBase,
    SlicerReceiptSourceFields {
  readonly kind: 'slicer.selection.set';
  readonly status: 'applied';
  readonly slicerId: string;
  readonly selectedItems: readonly CellValue[];
  readonly slicer?: Slicer | null;
}

export interface SlicerSelectionClearReceipt
  extends OperationReceiptBase,
    SlicerReceiptSourceFields {
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
  | TableRemoveReceipt
  | TableResizeReceipt
  | TableAddColumnReceipt
  | TableRemoveColumnReceipt
  | TableAddRowReceipt
  | TableDeleteRowReceipt
  | NameAddReceipt
  | NameRemoveReceipt
  | NameUpdateReceipt
  | NameClearReceipt
  | AutoFilterSetReceipt
  | AutoFilterClearReceipt
  | ValidationSetReceipt
  | ValidationRemoveReceipt
  | ValidationClearReceipt
  | CommentReceipt
  | ConditionalFormatMutationReceipt
  | UndoReceipt
  | RedoReceipt
  | PivotRemoveReceipt
  | PivotAddReceipt
  | PivotAddWithSheetReceipt
  | PivotRefreshReceipt
  | PivotRefreshAllReceipt
  | SlicerMutationReceipt
  | PivotKernelMutationReceipt
  | PivotPlacementMutationReceipt
  | PivotCommandReceipt;
