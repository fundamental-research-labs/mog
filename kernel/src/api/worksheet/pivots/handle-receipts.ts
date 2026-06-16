import type {
  OperationDiagnostic,
  OperationEffect,
  PivotHandleCalculatedFieldReceipt,
  PivotHandleDeleteReceipt,
  PivotHandleExpansionReceipt,
  PivotHandleMutationKind,
  PivotHandleMutationReceipt,
} from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  CalculatedFieldId,
  PivotFieldArea,
  PivotFieldPlacementFlat,
  PivotKernelMutationReceipt,
  PlacementId,
  PivotTableConfig as DataPivotTableConfig,
} from '@mog-sdk/contracts/pivot';
import {
  kernelReceiptDiagnostics,
  pivotConfigMutationEffects,
  pivotUnchangedEffects,
} from './receipts';

function placementIdFromKernelReceipt(receipt: PivotKernelMutationReceipt): PlacementId | undefined {
  const placementReceipt = receipt as PivotKernelMutationReceipt & { placementId?: PlacementId };
  if (placementReceipt.placementId) return placementReceipt.placementId;
  return receipt.effects.find((effect) => effect.placementId)?.placementId;
}

export function buildPivotHandleMutationReceipt(input: {
  kind: PivotHandleMutationKind;
  sheetId: SheetId;
  pivotId: string;
  status?: PivotHandleMutationReceipt['status'];
  config?: DataPivotTableConfig;
  fieldId?: string;
  area?: PivotFieldArea;
  placementId?: PlacementId;
  placement?: PivotFieldPlacementFlat;
  calculatedFieldId?: CalculatedFieldId;
  deleted?: boolean;
  expanded?: boolean;
  effects?: OperationEffect[];
  diagnostics?: OperationDiagnostic[];
  details?: Record<string, unknown>;
}): PivotHandleMutationReceipt {
  const status = input.status ?? 'applied';
  const effects =
    input.effects ??
    (status === 'applied'
      ? pivotConfigMutationEffects({
          sheetId: input.sheetId,
          pivotId: input.pivotId,
          kind: input.kind,
          details: input.details,
        })
      : pivotUnchangedEffects({
          sheetId: input.sheetId,
          pivotId: input.pivotId,
          kind: input.kind,
        }));

  return {
    kind: input.kind,
    status,
    effects,
    diagnostics: input.diagnostics ?? [],
    sheetId: input.sheetId,
    pivotId: input.pivotId,
    ...(input.config ? { config: input.config } : {}),
    ...(input.fieldId ? { fieldId: input.fieldId } : {}),
    ...(input.area ? { area: input.area } : {}),
    ...(input.placementId ? { placementId: input.placementId } : {}),
    ...(input.placement ? { placement: input.placement } : {}),
    ...(input.calculatedFieldId ? { calculatedFieldId: input.calculatedFieldId } : {}),
    ...(input.deleted !== undefined ? { deleted: input.deleted } : {}),
    ...(input.expanded !== undefined ? { expanded: input.expanded } : {}),
  };
}

export function buildPivotHandleKernelReceipt(input: {
  kind: PivotHandleMutationKind;
  sheetId: SheetId;
  kernelReceipt: PivotKernelMutationReceipt;
  config?: DataPivotTableConfig;
  fieldId?: string;
  area?: PivotFieldArea;
  placementId?: PlacementId;
  placement?: PivotFieldPlacementFlat;
  calculatedFieldId?: CalculatedFieldId;
}): PivotHandleMutationReceipt {
  const status = input.kernelReceipt.status;
  const placementId =
    input.placementId ??
    input.placement?.placementId ??
    placementIdFromKernelReceipt(input.kernelReceipt);
  const effects =
    status === 'applied'
      ? pivotConfigMutationEffects({
          sheetId: input.sheetId,
          pivotId: input.kernelReceipt.pivotId,
          kind: input.kind,
          details: {
            kernelReceiptId: input.kernelReceipt.kernelReceiptId,
            updateReason: input.kernelReceipt.updateReason,
            refreshPolicy: input.kernelReceipt.refreshPolicy,
            domainEffects: input.kernelReceipt.effects,
          },
        })
      : pivotUnchangedEffects({
          sheetId: input.sheetId,
          pivotId: input.kernelReceipt.pivotId,
          kind: input.kind,
          reason: input.kernelReceipt.error?.code,
        });
  return {
    ...buildPivotHandleMutationReceipt({
      kind: input.kind,
      sheetId: input.sheetId,
      pivotId: input.kernelReceipt.pivotId,
      status,
      config: input.config,
      fieldId: input.fieldId,
      area: input.area,
      placementId,
      placement: input.placement,
      calculatedFieldId: input.calculatedFieldId,
      effects,
      diagnostics: kernelReceiptDiagnostics({
        sheetId: input.sheetId,
        receipt: input.kernelReceipt,
      }),
    }),
    kernelReceipt: input.kernelReceipt,
  };
}

export function buildPivotHandleCalculatedFieldReceipt(input: {
  sheetId: SheetId;
  kernelReceipt: PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId };
  config?: DataPivotTableConfig;
}): PivotHandleCalculatedFieldReceipt {
  return buildPivotHandleKernelReceipt({
    kind: 'pivot.handle.addCalculatedField',
    sheetId: input.sheetId,
    kernelReceipt: input.kernelReceipt,
    config: input.config,
    calculatedFieldId: input.kernelReceipt.calculatedFieldId,
  }) as PivotHandleCalculatedFieldReceipt;
}

export function buildPivotHandleDeleteReceipt(input: {
  sheetId: SheetId;
  pivotId: string;
  deleted: boolean;
}): PivotHandleDeleteReceipt {
  return buildPivotHandleMutationReceipt({
    kind: 'pivot.handle.delete',
    sheetId: input.sheetId,
    pivotId: input.pivotId,
    status: input.deleted ? 'applied' : 'noOp',
    deleted: input.deleted,
    effects: input.deleted
      ? [
          {
            type: 'removedObject',
            sheetId: input.sheetId,
            objectId: input.pivotId,
            details: { objectType: 'pivotTable' },
          },
          {
            type: 'invalidatedCache',
            sheetId: input.sheetId,
            objectId: input.pivotId,
            details: { objectType: 'pivotTable', operation: 'pivot.handle.delete' },
          },
        ]
      : pivotUnchangedEffects({
          sheetId: input.sheetId,
          pivotId: input.pivotId,
          kind: 'pivot.handle.delete',
          reason: 'alreadyDeleted',
        }),
  }) as PivotHandleDeleteReceipt;
}

export function buildPivotHandleExpansionReceipt(input: {
  kind: 'pivot.handle.toggleExpanded' | 'pivot.handle.setAllExpanded';
  sheetId: SheetId;
  pivotId: string;
  expanded: boolean;
  applied: boolean;
  headerKey?: string;
  isRow?: boolean;
}): PivotHandleExpansionReceipt {
  return buildPivotHandleMutationReceipt({
    kind: input.kind,
    sheetId: input.sheetId,
    pivotId: input.pivotId,
    status: input.applied ? 'applied' : 'noOp',
    expanded: input.expanded,
    effects: input.applied
      ? [
          {
            type: 'updatedExpansionState',
            sheetId: input.sheetId,
            objectId: input.pivotId,
            details: {
              objectType: 'pivotTable',
              operation: input.kind,
              expanded: input.expanded,
              ...(input.headerKey ? { headerKey: input.headerKey } : {}),
              ...(input.isRow !== undefined ? { isRow: input.isRow } : {}),
            },
          },
          {
            type: 'invalidatedCache',
            sheetId: input.sheetId,
            objectId: input.pivotId,
            details: { objectType: 'pivotTable', operation: input.kind },
          },
        ]
      : pivotUnchangedEffects({
          sheetId: input.sheetId,
          pivotId: input.pivotId,
          kind: input.kind,
          reason: 'unchangedExpansionState',
        }),
  }) as PivotHandleExpansionReceipt;
}
