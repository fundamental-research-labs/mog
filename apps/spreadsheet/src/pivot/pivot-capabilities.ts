import type { PivotTableHandle } from '@mog-sdk/contracts/api';
import type { PivotTableWithResult } from '@mog-sdk/contracts/pivot';

export type PivotSourceKind = 'native' | 'promotedImport' | 'unsupportedImport';

export interface PivotCapabilities {
  canEditFields: boolean;
  canMove: boolean;
  canReorderFields: boolean;
  canRemove: boolean;
  canRemoveFields: boolean;
  canChangeAggregate: boolean;
  canSortLabels: boolean;
  canSortByValue: boolean;
  canRename: boolean;
  canShowValuesAs: boolean;
  canRefresh: boolean;
  canDelete: boolean;
  canExport: boolean;
  unsupportedReason?: string;
}

export interface PivotViewModel extends PivotTableWithResult {
  sourceKind: PivotSourceKind;
  importIdentity?: string;
  capabilities: PivotCapabilities;
  handle?: PivotTableHandle;
}

export const UNSUPPORTED_IMPORTED_PIVOT_REASON =
  'This imported PivotTable uses workbook features that are preserved for export but are not editable in Mog yet.';

export function createNativePivotCapabilities(): PivotCapabilities {
  return {
    canEditFields: true,
    canMove: true,
    canReorderFields: true,
    canRemove: true,
    canRemoveFields: true,
    canChangeAggregate: true,
    canSortLabels: true,
    canSortByValue: true,
    canRename: true,
    canShowValuesAs: true,
    canRefresh: true,
    canDelete: true,
    canExport: true,
  };
}

export function createUnsupportedImportPivotCapabilities(
  unsupportedReason = UNSUPPORTED_IMPORTED_PIVOT_REASON,
): PivotCapabilities {
  return {
    canEditFields: false,
    canMove: false,
    canReorderFields: false,
    canRemove: false,
    canRemoveFields: false,
    canChangeAggregate: false,
    canSortLabels: false,
    canSortByValue: false,
    canRename: false,
    canShowValuesAs: false,
    canRefresh: false,
    canDelete: false,
    canExport: true,
    unsupportedReason,
  };
}

export function createPivotCapabilitiesForSource(
  sourceKind: PivotSourceKind,
  unsupportedReason?: string,
): PivotCapabilities {
  return sourceKind === 'unsupportedImport'
    ? createUnsupportedImportPivotCapabilities(unsupportedReason)
    : createNativePivotCapabilities();
}
