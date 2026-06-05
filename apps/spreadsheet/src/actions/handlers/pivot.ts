import type { AsyncActionHandler, ActionResult } from '@mog-sdk/contracts/actions';
import type { MutationReceipt, PivotTableHandle } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  CalculatedField,
  PivotFilter,
  ShowValuesAsConfig,
} from '@mog-sdk/contracts/pivot';

interface PivotActionBasePayload {
  sheetId?: SheetId;
  pivotName: string;
}

interface PivotSetShowValuesAsPayload extends PivotActionBasePayload {
  fieldId?: string;
  placementId?: string;
  showValuesAs: ShowValuesAsConfig | null;
}

interface PivotSetGrandTotalsPayload extends PivotActionBasePayload {
  showRowGrandTotals: boolean;
  showColumnGrandTotals: boolean;
}

interface PivotSetDataSourcePayload extends PivotActionBasePayload {
  dataSource: string;
}

interface PivotSetFilterPayload extends PivotActionBasePayload {
  fieldId: string;
  filter: Omit<PivotFilter, 'fieldId'>;
}

interface PivotAddCalculatedFieldPayload extends PivotActionBasePayload {
  field: CalculatedField;
}

function invalidPayload(message: string): ActionResult {
  return { handled: false, reason: 'wrong_context', error: message };
}

function isObjectPayload(payload: unknown): payload is Record<string, unknown> {
  return payload != null && typeof payload === 'object';
}

function getWorksheet(deps: Parameters<AsyncActionHandler>[0], sheetId?: SheetId) {
  return sheetId
    ? deps.workbook.getSheetById(sheetId)
    : deps.workbook.getSheetById(deps.getActiveSheetId());
}

function parsePivotTarget(
  payload: Record<string, unknown>,
  actionName: string,
): PivotActionBasePayload | ActionResult {
  const { sheetId, pivotName } = payload;
  if (sheetId !== undefined && typeof sheetId !== 'string') {
    return invalidPayload(`${actionName} sheetId must be a string`);
  }
  if (typeof pivotName !== 'string' || pivotName.length === 0) {
    return invalidPayload(`${actionName} pivotName must be a non-empty string`);
  }

  return {
    sheetId: sheetId as SheetId | undefined,
    pivotName,
  };
}

async function resolvePivotHandle(
  ws: ReturnType<typeof getWorksheet>,
  pivotName: string,
): Promise<PivotTableHandle | null> {
  return ws.pivots.get(pivotName);
}

function parseShowValuesAsPayload(payload: unknown): PivotSetShowValuesAsPayload | ActionResult {
  if (!isObjectPayload(payload)) {
    return invalidPayload('PIVOT_SET_SHOW_VALUES_AS requires a payload');
  }

  const target = parsePivotTarget(payload, 'PIVOT_SET_SHOW_VALUES_AS');
  if ('handled' in target) return target;
  const { fieldId, placementId, showValuesAs } = payload;
  if (fieldId !== undefined && (typeof fieldId !== 'string' || fieldId.length === 0)) {
    return invalidPayload('PIVOT_SET_SHOW_VALUES_AS fieldId must be a non-empty string');
  }
  if (placementId !== undefined && (typeof placementId !== 'string' || placementId.length === 0)) {
    return invalidPayload('PIVOT_SET_SHOW_VALUES_AS placementId must be a non-empty string');
  }
  if (fieldId === undefined && placementId === undefined) {
    return invalidPayload('PIVOT_SET_SHOW_VALUES_AS requires fieldId or placementId');
  }
  if (showValuesAs !== null && !isObjectPayload(showValuesAs)) {
    return invalidPayload('PIVOT_SET_SHOW_VALUES_AS showValuesAs must be an object or null');
  }

  return {
    ...target,
    fieldId: fieldId as string | undefined,
    placementId: placementId as string | undefined,
    showValuesAs: showValuesAs as ShowValuesAsConfig | null,
  };
}

function parseGrandTotalsPayload(payload: unknown): PivotSetGrandTotalsPayload | ActionResult {
  if (!isObjectPayload(payload)) {
    return invalidPayload('PIVOT_SET_GRAND_TOTALS requires a payload');
  }

  const target = parsePivotTarget(payload, 'PIVOT_SET_GRAND_TOTALS');
  if ('handled' in target) return target;
  const { showRowGrandTotals, showColumnGrandTotals } = payload;
  if (typeof showRowGrandTotals !== 'boolean') {
    return invalidPayload('PIVOT_SET_GRAND_TOTALS showRowGrandTotals must be a boolean');
  }
  if (typeof showColumnGrandTotals !== 'boolean') {
    return invalidPayload('PIVOT_SET_GRAND_TOTALS showColumnGrandTotals must be a boolean');
  }

  return {
    ...target,
    showRowGrandTotals,
    showColumnGrandTotals,
  };
}

function parseDataSourcePayload(payload: unknown): PivotSetDataSourcePayload | ActionResult {
  if (!isObjectPayload(payload)) {
    return invalidPayload('PIVOT_SET_DATA_SOURCE requires a payload');
  }

  const target = parsePivotTarget(payload, 'PIVOT_SET_DATA_SOURCE');
  if ('handled' in target) return target;
  const { dataSource } = payload;
  if (typeof dataSource !== 'string' || dataSource.length === 0) {
    return invalidPayload('PIVOT_SET_DATA_SOURCE dataSource must be a non-empty string');
  }

  return {
    ...target,
    dataSource,
  };
}

function parseFilterPayload(payload: unknown): PivotSetFilterPayload | ActionResult {
  if (!isObjectPayload(payload)) {
    return invalidPayload('PIVOT_SET_FILTER requires a payload');
  }

  const target = parsePivotTarget(payload, 'PIVOT_SET_FILTER');
  if ('handled' in target) return target;
  const { fieldId, filter } = payload;
  if (typeof fieldId !== 'string' || fieldId.length === 0) {
    return invalidPayload('PIVOT_SET_FILTER fieldId must be a non-empty string');
  }
  if (!isObjectPayload(filter)) {
    return invalidPayload('PIVOT_SET_FILTER filter must be an object');
  }

  return {
    ...target,
    fieldId,
    filter: filter as Omit<PivotFilter, 'fieldId'>,
  };
}

function parseAddCalculatedFieldPayload(
  payload: unknown,
): PivotAddCalculatedFieldPayload | ActionResult {
  if (!isObjectPayload(payload)) {
    return invalidPayload('PIVOT_ADD_CALCULATED_FIELD requires a payload');
  }

  const target = parsePivotTarget(payload, 'PIVOT_ADD_CALCULATED_FIELD');
  if ('handled' in target) return target;
  const { field } = payload;
  if (!isObjectPayload(field)) {
    return invalidPayload('PIVOT_ADD_CALCULATED_FIELD field must be an object');
  }
  if (typeof field.fieldId !== 'string' || field.fieldId.length === 0) {
    return invalidPayload('PIVOT_ADD_CALCULATED_FIELD field.fieldId must be a non-empty string');
  }
  if (typeof field.name !== 'string' || field.name.length === 0) {
    return invalidPayload('PIVOT_ADD_CALCULATED_FIELD field.name must be a non-empty string');
  }
  if (typeof field.formula !== 'string' || field.formula.length === 0) {
    return invalidPayload('PIVOT_ADD_CALCULATED_FIELD field.formula must be a non-empty string');
  }

  return {
    ...target,
    field: field as unknown as CalculatedField,
  };
}

export const PIVOT_SET_SHOW_VALUES_AS: AsyncActionHandler = async (deps, payload) => {
  const parsed = parseShowValuesAsPayload(payload);
  if ('handled' in parsed) return parsed;

  const ws = getWorksheet(deps, parsed.sheetId);
  const target = await resolvePivotHandle(ws, parsed.pivotName);
  if (!target) return invalidPayload('PIVOT_SET_SHOW_VALUES_AS pivot not found');
  const placementReference = parsed.placementId ?? parsed.fieldId!;
  await target.setShowValuesAs(placementReference, parsed.showValuesAs);
  await target.refresh();
  return { handled: true };
};

export const PIVOT_SET_GRAND_TOTALS: AsyncActionHandler = async (deps, payload) => {
  const parsed = parseGrandTotalsPayload(payload);
  if ('handled' in parsed) return parsed;

  const ws = getWorksheet(deps, parsed.sheetId);
  const target = await resolvePivotHandle(ws, parsed.pivotName);
  if (!target) return invalidPayload('PIVOT_SET_GRAND_TOTALS pivot not found');
  const layout = {
    showRowGrandTotals: parsed.showRowGrandTotals,
    showColumnGrandTotals: parsed.showColumnGrandTotals,
  };
  await target.setLayout(layout);
  await target.refresh();
  return { handled: true };
};

export const PIVOT_SET_DATA_SOURCE: AsyncActionHandler = async (deps, payload) => {
  const parsed = parseDataSourcePayload(payload);
  if ('handled' in parsed) return parsed;

  const ws = getWorksheet(deps, parsed.sheetId);
  const target = await resolvePivotHandle(ws, parsed.pivotName);
  if (!target) return invalidPayload('PIVOT_SET_DATA_SOURCE pivot not found');
  await target.setDataSource(parsed.dataSource);
  return { handled: true };
};

export const PIVOT_SET_FILTER: AsyncActionHandler = async (deps, payload) => {
  const parsed = parseFilterPayload(payload);
  if ('handled' in parsed) return parsed;

  const ws = getWorksheet(deps, parsed.sheetId);
  const target = await resolvePivotHandle(ws, parsed.pivotName);
  if (!target) return invalidPayload('PIVOT_SET_FILTER pivot not found');
  await target.setFilter(parsed.fieldId, parsed.filter);
  return { handled: true };
};

export const PIVOT_ADD_CALCULATED_FIELD: AsyncActionHandler = async (deps, payload) => {
  const parsed = parseAddCalculatedFieldPayload(payload);
  if ('handled' in parsed) return parsed;

  const ws = getWorksheet(deps, parsed.sheetId);
  const target = await resolvePivotHandle(ws, parsed.pivotName);
  if (!target) return invalidPayload('PIVOT_ADD_CALCULATED_FIELD pivot not found');
  const mutationReceipt = await target.addCalculatedField(parsed.field);
  await target.refresh();
  const receipts = [mutationReceipt].filter(Boolean) as unknown as MutationReceipt[];
  return receipts.length > 0 ? { handled: true, receipts } : { handled: true };
};
