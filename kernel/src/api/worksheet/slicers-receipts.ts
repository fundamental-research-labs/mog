import type {
  OperationEffect,
  Slicer,
  SlicerAddReceipt,
  SlicerClearReceipt,
  SlicerDuplicateReceipt,
  SlicerRemoveReceipt,
  SlicerSelectionClearReceipt,
  SlicerSelectionSetReceipt,
  SlicerUpdateReceipt,
} from '@mog-sdk/contracts/api';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import { KernelError } from '../../errors';

export type SlicerSourceLike =
  | ({ type: 'table'; tableId?: string; columnCellId?: string } & Record<string, unknown>)
  | ({ type: 'pivot'; pivotId?: string; fieldName?: string } & Record<string, unknown>)
  | { type: 'table' | 'pivot' }
  | null
  | undefined;

export interface SlicerFilterProjectionReceiptInput {
  readonly sheetId: SheetId;
  readonly range?: string;
  readonly filterId?: string;
  readonly sourceTableId?: string;
  readonly columnCellId?: string;
  readonly columnIndex?: number;
}

function compactDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

function sourceFields(source: SlicerSourceLike): {
  sourceTableId?: string;
  sourcePivotId?: string;
} {
  if (!source) return {};
  if (source.type === 'table') {
    const tableId = (source as { tableId?: unknown }).tableId;
    const sourceTableId = typeof tableId === 'string' ? tableId : undefined;
    return sourceTableId ? { sourceTableId } : {};
  }
  if (source.type === 'pivot') {
    const pivotId = (source as { pivotId?: unknown }).pivotId;
    const sourcePivotId = typeof pivotId === 'string' ? pivotId : undefined;
    return sourcePivotId ? { sourcePivotId } : {};
  }
  return {};
}

function sourceFor(slicer: Slicer | null | undefined, source?: SlicerSourceLike): SlicerSourceLike {
  return source ?? (slicer?.source as SlicerSourceLike);
}

function sourceFieldsFor(
  slicer: Slicer | null | undefined,
  source?: SlicerSourceLike,
  projection?: SlicerFilterProjectionReceiptInput | null,
): { sourceTableId?: string; sourcePivotId?: string } {
  return {
    ...sourceFields(sourceFor(slicer, source)),
    ...(projection?.sourceTableId ? { sourceTableId: projection.sourceTableId } : {}),
  };
}

function slicerDetails(
  source: SlicerSourceLike,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return compactDetails({
    objectType: 'slicer',
    ...sourceFields(source),
    ...extra,
  });
}

function slicerObjectEffect(input: {
  type: 'createdObject' | 'updatedObject' | 'removedObject';
  sheetId: SheetId;
  slicerId?: string;
  source?: SlicerSourceLike;
  count?: number;
  details?: Record<string, unknown>;
}): OperationEffect {
  return {
    type: input.type,
    sheetId: input.sheetId,
    ...(input.slicerId ? { objectId: input.slicerId } : {}),
    ...(input.count !== undefined ? { count: input.count } : {}),
    details: slicerDetails(input.source, input.details),
  };
}

function invalidatedSlicerCacheEffect(input: {
  sheetId: SheetId;
  slicerId?: string;
  source?: SlicerSourceLike;
  count?: number;
}): OperationEffect {
  return {
    type: 'invalidatedCache',
    sheetId: input.sheetId,
    ...(input.slicerId ? { objectId: input.slicerId } : {}),
    ...(input.count !== undefined ? { count: input.count } : {}),
    details: slicerDetails(input.source, { cache: 'slicerList' }),
  };
}

function worksheetUnchangedEffect(sheetId: SheetId, slicerId?: string): OperationEffect {
  return {
    type: 'worksheetUnchanged',
    sheetId,
    ...(slicerId ? { objectId: slicerId } : {}),
    details: { objectType: 'slicer' },
  };
}

function filterProjectionEffect(projection: SlicerFilterProjectionReceiptInput): OperationEffect {
  return {
    type: 'changedFilterProjection',
    sheetId: projection.sheetId,
    ...(projection.range ? { range: projection.range } : {}),
    details: compactDetails({
      objectType: 'slicer',
      sourceTableId: projection.sourceTableId,
      filterId: projection.filterId,
      columnCellId: projection.columnCellId,
      columnIndex: projection.columnIndex,
    }),
  };
}

export function buildSlicerAddReceipt(input: {
  sheetId: SheetId;
  slicer: Slicer;
}): SlicerAddReceipt {
  const source = sourceFor(input.slicer);
  return {
    kind: 'slicer.add',
    status: 'applied',
    effects: [
      slicerObjectEffect({
        type: 'createdObject',
        sheetId: input.sheetId,
        slicerId: input.slicer.id,
        source,
      }),
      invalidatedSlicerCacheEffect({
        sheetId: input.sheetId,
        slicerId: input.slicer.id,
        source,
      }),
    ],
    diagnostics: [],
    slicerId: input.slicer.id,
    slicer: input.slicer,
    ...sourceFieldsFor(input.slicer),
  };
}

export function buildSlicerUpdateReceipt(input: {
  sheetId: SheetId;
  slicer: Slicer;
  noOp?: boolean;
}): SlicerUpdateReceipt {
  const source = sourceFor(input.slicer);
  return {
    kind: 'slicer.update',
    status: input.noOp ? 'noOp' : 'applied',
    effects: input.noOp
      ? [worksheetUnchangedEffect(input.sheetId, input.slicer.id)]
      : [
          slicerObjectEffect({
            type: 'updatedObject',
            sheetId: input.sheetId,
            slicerId: input.slicer.id,
            source,
          }),
          invalidatedSlicerCacheEffect({
            sheetId: input.sheetId,
            slicerId: input.slicer.id,
            source,
          }),
        ],
    diagnostics: [],
    slicerId: input.slicer.id,
    slicer: input.slicer,
    ...sourceFieldsFor(input.slicer),
  };
}

export function buildSlicerRemoveReceipt(input: {
  sheetId: SheetId;
  slicer: Slicer;
}): SlicerRemoveReceipt {
  const source = sourceFor(input.slicer);
  return {
    kind: 'slicer.remove',
    status: 'applied',
    effects: [
      slicerObjectEffect({
        type: 'removedObject',
        sheetId: input.sheetId,
        slicerId: input.slicer.id,
        source,
      }),
      invalidatedSlicerCacheEffect({
        sheetId: input.sheetId,
        slicerId: input.slicer.id,
        source,
      }),
    ],
    diagnostics: [],
    slicerId: input.slicer.id,
    slicer: input.slicer,
    ...sourceFieldsFor(input.slicer),
  };
}

export function buildSlicerClearReceipt(input: {
  sheetId: SheetId;
  slicers: readonly Slicer[];
}): SlicerClearReceipt {
  const slicerIds = input.slicers.map((slicer) => slicer.id);
  if (new Set(slicerIds).size !== slicerIds.length) {
    throw new KernelError(
      'OPERATION_FAILED',
      'slicers.clear: duplicate authoritative delete evidence',
    );
  }
  if (slicerIds.length === 0) {
    return {
      kind: 'slicer.clear',
      status: 'noOp',
      effects: [worksheetUnchangedEffect(input.sheetId)],
      diagnostics: [],
      slicerIds: [],
      slicers: [],
      removedCount: 0,
    };
  }

  return {
    kind: 'slicer.clear',
    status: 'applied',
    effects: [
      slicerObjectEffect({
        type: 'removedObject',
        sheetId: input.sheetId,
        count: slicerIds.length,
      }),
      invalidatedSlicerCacheEffect({
        sheetId: input.sheetId,
        count: slicerIds.length,
      }),
    ],
    diagnostics: [],
    slicerIds,
    slicers: input.slicers,
    removedCount: slicerIds.length,
  };
}

export function buildSlicerDuplicateReceipt(input: {
  sheetId: SheetId;
  sourceSlicerId: string;
  slicer: Slicer;
}): SlicerDuplicateReceipt {
  const source = sourceFor(input.slicer);
  return {
    kind: 'slicer.duplicate',
    status: 'applied',
    effects: [
      slicerObjectEffect({
        type: 'createdObject',
        sheetId: input.sheetId,
        slicerId: input.slicer.id,
        source,
        details: { sourceSlicerId: input.sourceSlicerId },
      }),
      invalidatedSlicerCacheEffect({
        sheetId: input.sheetId,
        slicerId: input.slicer.id,
        source,
      }),
    ],
    diagnostics: [],
    slicerId: input.slicer.id,
    sourceSlicerId: input.sourceSlicerId,
    slicer: input.slicer,
    ...sourceFieldsFor(input.slicer),
  };
}

function selectionEffects(input: {
  sheetId: SheetId;
  slicerId: string;
  selectedItems: readonly CellValue[];
  source?: SlicerSourceLike;
  projection?: SlicerFilterProjectionReceiptInput | null;
}): OperationEffect[] {
  return [
    slicerObjectEffect({
      type: 'updatedObject',
      sheetId: input.sheetId,
      slicerId: input.slicerId,
      source: input.source,
      details: { selectedCount: input.selectedItems.length },
    }),
    ...(input.projection ? [filterProjectionEffect(input.projection)] : []),
    invalidatedSlicerCacheEffect({
      sheetId: input.sheetId,
      slicerId: input.slicerId,
      source: input.source,
    }),
  ];
}

export function buildSlicerSelectionSetReceipt(input: {
  sheetId: SheetId;
  slicer: Slicer;
  projection?: SlicerFilterProjectionReceiptInput | null;
}): SlicerSelectionSetReceipt {
  const source = sourceFor(input.slicer);
  return {
    kind: 'slicer.selection.set',
    status: 'applied',
    effects: selectionEffects({
      sheetId: input.sheetId,
      slicerId: input.slicer.id,
      selectedItems: input.slicer.selectedItems,
      source,
      projection: input.projection,
    }),
    diagnostics: [],
    slicerId: input.slicer.id,
    selectedItems: input.slicer.selectedItems,
    slicer: input.slicer,
    ...sourceFieldsFor(input.slicer, undefined, input.projection),
  };
}

export function buildSlicerSelectionClearReceipt(input: {
  sheetId: SheetId;
  slicer: Slicer;
  projection?: SlicerFilterProjectionReceiptInput | null;
}): SlicerSelectionClearReceipt {
  if (input.slicer.selectedItems.length !== 0) {
    throw new KernelError(
      'OPERATION_FAILED',
      'slicers.clearSelection: authoritative state still contains selected items',
    );
  }
  const source = sourceFor(input.slicer);
  return {
    kind: 'slicer.selection.clear',
    status: 'applied',
    effects: selectionEffects({
      sheetId: input.sheetId,
      slicerId: input.slicer.id,
      selectedItems: [],
      source,
      projection: input.projection,
    }),
    diagnostics: [],
    slicerId: input.slicer.id,
    selectedItems: [] as const,
    slicer: input.slicer,
    ...sourceFieldsFor(input.slicer, undefined, input.projection),
  };
}
