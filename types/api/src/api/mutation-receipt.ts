/**
 * Mutation Receipt Types
 *
 * Typed receipts returned by pull-path mutations. Instead of returning just
 * an ID or void, mutations return rich typed data that downstream consumers
 * (rendering, selection, undo) can use without re-querying.
 */

import type { ObjectBounds } from '../kernel/floating-object-manager';
import type { FloatingObject } from '@mog/types-objects/objects/floating-objects';
import type { OperationReceiptBase } from './operation-receipt';
import type {
  PivotCommandReceipt,
  PivotKernelMutationReceipt,
  PivotPlacementMutationReceipt,
  PivotReadbackRevision,
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

/** Receipt for a named range add mutation. */
export interface NameAddReceipt {
  readonly kind: 'nameAdd';
  readonly name: string;
  readonly reference: string;
}

/** Receipt for a named range remove mutation. */
export interface NameRemoveReceipt {
  readonly kind: 'nameRemove';
  readonly name: string;
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

/** Receipt for setting a validation rule. */
export interface ValidationSetReceipt {
  readonly kind: 'validationSet';
  readonly address: string;
}

/** Receipt for removing a validation rule. */
export interface ValidationRemoveReceipt {
  readonly kind: 'validationRemove';
  readonly address: string;
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

/** Receipt for a pivot table refresh mutation. */
export interface PivotRefreshReceipt {
  readonly kind: 'pivotRefresh';
  readonly pivotId: string;
}

// =============================================================================
// Discriminated Union
// =============================================================================

/** Union of all mutation receipt types. */
export type MutationReceipt =
  | FloatingObjectMutationReceipt
  | FloatingObjectRemoveReceipt
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
  | AutoFilterSetReceipt
  | AutoFilterClearReceipt
  | ValidationSetReceipt
  | ValidationRemoveReceipt
  | UndoReceipt
  | RedoReceipt
  | PivotRemoveReceipt
  | PivotRefreshReceipt
  | PivotKernelMutationReceipt
  | PivotPlacementMutationReceipt
  | PivotCommandReceipt;
