import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  CalculatedField,
  CalculatedFieldId,
  PivotFieldPlacementFlat,
  PivotKernelMutationReceipt,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../context';
import { cleanPivotFormula, makePlacementId, pivotCalculatedFieldId } from './identifiers';
import { requirePivot, resolvePivotName } from './lookup';
import { createMutationReceipt } from './receipts';

type PivotFieldPlacement = PivotFieldPlacementFlat;

export async function addPivotCalculatedFieldByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  field: CalculatedField;
}): Promise<void> {
  const { ctx, sheetId, pivotName, field } = options;
  const { pivotId, config } = await resolvePivotName(ctx, sheetId, pivotName, 'addCalculatedField');
  const cleanedField: CalculatedField = {
    ...field,
    formula: cleanPivotFormula(field.formula),
  };
  const calculatedFields = [...(config.calculatedFields ?? []), cleanedField];
  const existingPlacement = config.placements.find(
    (placement) => placement.fieldId === field.fieldId && placement.area === 'value',
  );
  let placements = config.placements;

  if (!existingPlacement) {
    const valuePlacements = config.placements.filter((placement) => placement.area === 'value');
    const newPlacement: PivotFieldPlacement = {
      placementId: makePlacementId('value', field.fieldId, valuePlacements.length),
      fieldId: field.fieldId,
      area: 'value',
      position: valuePlacements.length,
      aggregateFunction: 'sum',
      displayName: field.name,
    };
    placements = [...config.placements, newPlacement];
  }

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { calculatedFields, placements },
    { reason: 'calculatedFieldChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function addPivotCalculatedFieldToId(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotId: string;
  field: CalculatedField;
}): Promise<PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId }> {
  const { ctx, sheetId, pivotId, field } = options;
  const config = await requirePivot(ctx, sheetId, pivotId, 'addCalculatedField');
  const calculatedFieldId = pivotCalculatedFieldId(field.calculatedFieldId ?? field.name);
  const cleanedField: CalculatedField = {
    fieldId: field.fieldId,
    calculatedFieldId,
    name: field.name,
    formula: cleanPivotFormula(field.formula),
  };
  const result = await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { calculatedFields: [...(config.calculatedFields ?? []), cleanedField] },
    { reason: 'calculatedFieldChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
  return {
    ...createMutationReceipt(pivotId, 'calculatedFieldChanged', 'refreshAndMaterialize', result, [
      { type: 'calculatedFieldAdded', calculatedFieldId },
    ]),
    calculatedFieldId,
  };
}

export async function removePivotCalculatedFieldByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId } = options;
  const { pivotId, config } = await resolvePivotName(
    ctx,
    sheetId,
    pivotName,
    'removeCalculatedField',
  );
  const calculatedFields = (config.calculatedFields ?? []).filter(
    (field) => field.fieldId !== fieldId,
  );
  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { calculatedFields },
    { reason: 'calculatedFieldChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function updatePivotCalculatedFieldByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
  updates: Partial<Pick<CalculatedField, 'name' | 'formula'>>;
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId, updates } = options;
  const { pivotId, config } = await resolvePivotName(
    ctx,
    sheetId,
    pivotName,
    'updateCalculatedField',
  );
  const normalizedUpdates = {
    ...updates,
    ...(updates.formula != null ? { formula: cleanPivotFormula(updates.formula) } : {}),
  };
  const calculatedFields = (config.calculatedFields ?? []).map((field) =>
    field.fieldId === fieldId ? { ...field, ...normalizedUpdates } : field,
  );
  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { calculatedFields },
    { reason: 'calculatedFieldChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}
