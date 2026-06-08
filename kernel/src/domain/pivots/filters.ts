import type { CellError, CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { PivotFieldItems, PivotFilter, PivotItemInfo } from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../context';
import { requirePivot, resolvePivotName } from './lookup';

const BLANK_MEMBER_KEY = '\u0000BLANK\u0000';
const ARRAY_MEMBER_KEY = '\u0000ARRAY\u0000';
const LAMBDA_MEMBER_KEY = '\u0000LAMBDA\u0000';

const ERROR_DISPLAY_TO_VARIANT: Record<string, CellError['value']> = {
  '#NULL!': 'Null',
  '#DIV/0!': 'Div0',
  '#VALUE!': 'Value',
  '#REF!': 'Ref',
  '#NAME?': 'Name',
  '#NUM!': 'Num',
  '#N/A': 'Na',
  '#GETTING_DATA': 'GettingData',
  '#SPILL!': 'Spill',
  '#CALC!': 'Calc',
  '#CIRC!': 'Circ',
};

function isCellErrorValue(value: unknown): value is CellError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'error' &&
    typeof (value as { value?: unknown }).value === 'string'
  );
}

function isCellValue(value: unknown): value is CellValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    isCellErrorValue(value)
  );
}

function terminalMemberKey(identifier: string): string {
  if (identifier.endsWith(BLANK_MEMBER_KEY)) return BLANK_MEMBER_KEY;
  if (identifier.endsWith(ARRAY_MEMBER_KEY)) return ARRAY_MEMBER_KEY;
  if (identifier.endsWith(LAMBDA_MEMBER_KEY)) return LAMBDA_MEMBER_KEY;
  const lastSeparator = identifier.lastIndexOf('\u0000');
  return lastSeparator >= 0 ? identifier.slice(lastSeparator + 1) : identifier;
}

function decodePivotMemberKey(identifier: string): CellValue | undefined {
  const memberKey = terminalMemberKey(identifier);

  if (memberKey === BLANK_MEMBER_KEY) {
    return null;
  }

  if (memberKey.startsWith('T:')) {
    return memberKey.slice(2);
  }

  if (memberKey === 'B:true') {
    return true;
  }

  if (memberKey === 'B:false') {
    return false;
  }

  if (memberKey.startsWith('N:')) {
    try {
      const bits = BigInt(memberKey.slice(2));
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      view.setBigUint64(0, bits, false);
      const number = view.getFloat64(0, false);
      if (Number.isFinite(number)) {
        return number;
      }
    } catch {
      return undefined;
    }
  }

  if (memberKey.startsWith('E:')) {
    const variant = ERROR_DISPLAY_TO_VARIANT[memberKey.slice(2)];
    if (variant) {
      return { type: 'error', value: variant };
    }
  }

  return undefined;
}

function pivotItemFilterValue(item: PivotItemInfo): CellValue {
  const decoded = decodePivotMemberKey(String(item.key));
  if (decoded === null) {
    return null;
  }
  return isCellValue(item.value) ? item.value : (decoded ?? String(item.value ?? ''));
}

function itemValueIdentifier(value: CellValue): string {
  if (isCellErrorValue(value)) {
    return value.message ?? value.value;
  }
  return String(value);
}

function findFieldItems(groups: PivotFieldItems[], fieldId: string): PivotItemInfo[] {
  const fieldItems = groups.find(
    (group) => group.fieldId === fieldId || group.fieldName === fieldId,
  );
  return fieldItems?.items ?? [];
}

function resolveVisibilityValues(options: {
  groups: PivotFieldItems[];
  fieldId: string;
  identifiers: string[];
}): CellValue[] {
  const { groups, fieldId, identifiers } = options;
  const items = findFieldItems(groups, fieldId).filter(
    (item) => !item.isSubtotal && !item.isGrandTotal,
  );

  const byKey = new Map<string, CellValue>();
  const byValue = new Map<string, CellValue | undefined>();

  for (const item of items) {
    const value = pivotItemFilterValue(item);
    byKey.set(String(item.key), value);

    const valueKey = itemValueIdentifier(value);
    if (byValue.has(valueKey)) {
      byValue.set(valueKey, undefined);
    } else {
      byValue.set(valueKey, value);
    }
  }

  return identifiers.map((identifier) => {
    const keyed = byKey.get(identifier);
    if (keyed !== undefined || byKey.has(identifier)) {
      return keyed ?? null;
    }

    const valueMatched = byValue.get(identifier);
    if (valueMatched !== undefined) {
      return valueMatched;
    }

    return decodePivotMemberKey(identifier) ?? identifier;
  });
}

function buildVisibilityFilter(options: {
  fieldId: string;
  visibleValues: CellValue[];
  hiddenValues: CellValue[];
}): PivotFilter | null {
  const { fieldId, visibleValues, hiddenValues } = options;

  if (hiddenValues.length === 0) {
    return null;
  }

  if (visibleValues.length > 0 && visibleValues.length < hiddenValues.length) {
    return {
      fieldId,
      includeValues: visibleValues,
    };
  }

  return {
    fieldId,
    excludeValues: hiddenValues,
  };
}

export async function setPivotFilterByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
  filter: Omit<PivotFilter, 'fieldId'>;
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId, filter } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'setFilter');
  await setPivotFilterForId({ ctx, sheetId, pivotId, fieldId, filter });
}

export async function setPivotFilterForId(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotId: string;
  fieldId: string;
  filter: Omit<PivotFilter, 'fieldId'>;
}): Promise<void> {
  const { ctx, sheetId, pivotId, fieldId, filter } = options;
  const config = await requirePivot(ctx, sheetId, pivotId, 'setFilter');
  const filters = config.filters.filter((candidate) => candidate.fieldId !== fieldId);
  filters.push({ ...filter, fieldId });

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { filters },
    { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function removePivotFilterByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'removeFilter');
  await removePivotFilterForId({ ctx, sheetId, pivotId, fieldId });
}

export async function removePivotFilterForId(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotId: string;
  fieldId: string;
}): Promise<void> {
  const { ctx, sheetId, pivotId, fieldId } = options;
  const config = await requirePivot(ctx, sheetId, pivotId, 'removeFilter');
  const filters = config.filters.filter((filter) => filter.fieldId !== fieldId);

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { filters },
    { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function setPivotItemVisibilityByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
  visibleItems: Record<string, boolean>;
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId, visibleItems } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'setPivotItemVisibility');
  await setPivotItemVisibilityForId({ ctx, sheetId, pivotId, fieldId, visibleItems });
}

export async function setPivotItemVisibilityForId(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotId: string;
  fieldId: string;
  visibleItems: Record<string, boolean>;
}): Promise<void> {
  const { ctx, sheetId, pivotId, fieldId, visibleItems } = options;
  const config = await requirePivot(ctx, sheetId, pivotId, 'setPivotItemVisibility');
  const visibleKeys = Object.entries(visibleItems)
    .filter(([, visible]) => visible)
    .map(([key]) => key);
  const hiddenKeys = Object.entries(visibleItems)
    .filter(([, visible]) => !visible)
    .map(([key]) => key);
  const itemGroups = await ctx.pivot.getAllPivotItems(sheetId, pivotId);
  const visibleValues = resolveVisibilityValues({
    groups: itemGroups,
    fieldId,
    identifiers: visibleKeys,
  });
  const hiddenValues = resolveVisibilityValues({
    groups: itemGroups,
    fieldId,
    identifiers: hiddenKeys,
  });
  const filters = config.filters.filter((filter) => filter.fieldId !== fieldId);
  const filter = buildVisibilityFilter({ fieldId, visibleValues, hiddenValues });

  if (filter) {
    filters.push(filter);
  }

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { filters },
    { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}
