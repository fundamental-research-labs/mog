import type { CellValue } from '@mog-sdk/contracts/core';

import { KernelError } from '../../errors';

export type NormalizedSortColumn = {
  column: number;
  direction: 'asc' | 'desc';
  caseSensitive?: boolean;
} & (
  | {
      sortBy: 'value';
      customList?: CellValue[];
    }
  | {
      sortBy: 'cellColor' | 'fontColor';
      targetColor: string;
      colorPosition: 'top' | 'bottom';
    }
);

export interface NormalizedTableSortField {
  columnIndex: number;
  ascending?: boolean;
}

export interface NormalizedTableSortOptions {
  fields: NormalizedTableSortField[];
  matchCase?: boolean;
}

export interface NormalizedRangeSortOptions {
  columns: NormalizedSortColumn[];
  hasHeaders?: boolean;
  visibleRowsOnly?: boolean;
}

interface NormalizeSortFieldsOptions {
  context: string;
  maxColumnIndex?: number;
  matchCase?: boolean;
  allowOfficeColorSort?: boolean;
}

type SortFieldRecord = Record<string, unknown>;
type OfficeSortOn = 'value' | 'cellColor' | 'fontColor';

const COLUMN_KEY_NAMES = ['column', 'columnIndex', 'key'] as const;

/**
 * Map public API sort direction to bridge SortOrder.
 *
 * The public SortColumn uses 'asc'/'desc',
 * BridgeSortCriterion.direction is SortOrder = 'asc' | 'desc'.
 */
export function mapSortDirection(direction: 'asc' | 'desc' | undefined): 'asc' | 'desc' {
  if (direction === 'desc') return 'desc';
  return 'asc';
}

export function normalizeRangeSortOptions(
  value: unknown,
  options: NormalizeSortFieldsOptions,
): NormalizedRangeSortOptions {
  if (!isRecord(value)) {
    throw new KernelError(
      'COMPUTE_ERROR',
      `${options.context} requires options with a non-empty columns array`,
    );
  }

  const matchCase = normalizeOptionalBoolean(value.matchCase, `${options.context}.matchCase`);
  const hasHeaders = normalizeOptionalBoolean(value.hasHeaders, `${options.context}.hasHeaders`);
  const visibleRowsOnly = normalizeOptionalBoolean(
    value.visibleRowsOnly,
    `${options.context}.visibleRowsOnly`,
  );
  normalizeRangeSortOrientation(value.orientation, options.context);
  rejectExplicitSortMethod(value.method, options.context);

  return {
    columns: normalizeRangeSortColumns(value.columns, {
      ...options,
      matchCase,
      allowOfficeColorSort: true,
    }),
    hasHeaders,
    visibleRowsOnly,
  };
}

export function normalizeTableSortOptions(
  fields: unknown,
  matchCase: unknown,
  method: unknown,
  options: NormalizeSortFieldsOptions,
): NormalizedTableSortOptions {
  const normalizedMatchCase = normalizeOptionalBoolean(matchCase, `${options.context}.matchCase`);
  rejectExplicitSortMethod(method, options.context);
  return {
    fields: normalizeTableSortFields(fields, options),
    matchCase: normalizedMatchCase,
  };
}

export function normalizeRangeSortColumns(
  columns: unknown,
  options: NormalizeSortFieldsOptions,
): NormalizedSortColumn[] {
  const records = requireSortFieldArray(columns, `${options.context}.columns`);
  return records.map((field, index): NormalizedSortColumn => {
    const label = `${options.context}.columns[${index}]`;
    assertSupportedOfficeSortExtras(field, label, { allowOfficeColorSort: true });
    const officeSortOn = normalizeOfficeSortOn(field.sortOn, label);
    const column = normalizeColumnKey(field, label, options);
    const direction = normalizeDirection(field, label);
    const explicitCaseSensitive = normalizeOptionalBoolean(
      field.caseSensitive,
      `${label}.caseSensitive`,
    );
    const caseSensitive = explicitCaseSensitive ?? options.matchCase;

    if (field.sortBy === 'cellColor' || field.sortBy === 'fontColor') {
      const targetColor = normalizeRequiredString(field.targetColor, `${label}.targetColor`);
      const colorPosition = normalizeColorPosition(field.colorPosition, `${label}.colorPosition`);
      return {
        column,
        direction,
        caseSensitive,
        sortBy: field.sortBy,
        targetColor,
        colorPosition,
      };
    }

    if (officeSortOn === 'cellColor' || officeSortOn === 'fontColor') {
      const targetColor = normalizeRequiredString(field.color, `${label}.color`);
      return {
        column,
        direction,
        caseSensitive,
        sortBy: officeSortOn,
        targetColor,
        colorPosition: direction === 'desc' ? 'bottom' : 'top',
      };
    }

    if (field.sortBy != null && field.sortBy !== 'value') {
      throw new KernelError(
        'COMPUTE_ERROR',
        `${label}.sortBy must be "value", "cellColor", or "fontColor"`,
      );
    }

    const customList =
      field.customList === undefined ? undefined : normalizeCustomList(field.customList, index);
    return {
      column,
      direction,
      caseSensitive,
      sortBy: 'value',
      customList,
    };
  });
}

export function normalizeTableSortFields(
  fields: unknown,
  options: NormalizeSortFieldsOptions,
): NormalizedTableSortField[] {
  const records = requireSortFieldArray(fields, `${options.context}.fields`);
  return records.map((field, index): NormalizedTableSortField => {
    const label = `${options.context}.fields[${index}]`;
    assertSupportedOfficeSortExtras(field, label, { allowOfficeColorSort: false });
    const officeSortOn = normalizeOfficeSortOn(field.sortOn, label);
    if (officeSortOn !== undefined && officeSortOn !== 'value') {
      throw new KernelError(
        'COMPUTE_ERROR',
        `${label}.sortOn "${String(field.sortOn)}" is not supported for table sorting; value sorting is supported`,
      );
    }
    if (field.sortBy != null && field.sortBy !== 'value') {
      throw new KernelError('COMPUTE_ERROR', `${label}.sortBy must be "value" for table sorting`);
    }
    const columnIndex = normalizeColumnKey(field, label, options);
    const direction = normalizeDirection(field, label);
    return {
      columnIndex,
      ascending: direction !== 'desc',
    };
  });
}

function requireSortFieldArray(value: unknown, label: string): SortFieldRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new KernelError(
      'COMPUTE_ERROR',
      `${label} must be a non-empty array of sort field descriptors`,
    );
  }
  return value.map((field, index) => {
    if (!isRecord(field)) {
      throw new KernelError('COMPUTE_ERROR', `${label}[${index}] must be an object`);
    }
    return field;
  });
}

function normalizeColumnKey(
  field: SortFieldRecord,
  label: string,
  options: NormalizeSortFieldsOptions,
): number {
  const present = COLUMN_KEY_NAMES.filter((name) => field[name] !== undefined);
  if (present.length !== 1) {
    throw new KernelError(
      'COMPUTE_ERROR',
      `${label} must include exactly one of column, columnIndex, or key`,
    );
  }
  const keyName = present[0];
  const value = field[keyName];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new KernelError('COMPUTE_ERROR', `${label}.${keyName} must be a non-negative integer`);
  }
  const column = value as number;
  if (options.maxColumnIndex != null && column > options.maxColumnIndex) {
    throw new KernelError(
      'COMPUTE_ERROR',
      `${label}.${keyName} ${column} is outside the sortable column range 0-${options.maxColumnIndex}`,
    );
  }
  return column;
}

function normalizeDirection(field: SortFieldRecord, label: string): 'asc' | 'desc' {
  const rawDirection = field.direction;
  const rawAscending = field.ascending;
  const hasDirection = rawDirection !== undefined;
  const hasAscending = rawAscending !== undefined;

  let direction: 'asc' | 'desc' | undefined;
  if (hasDirection) {
    if (rawDirection !== 'asc' && rawDirection !== 'desc') {
      throw new KernelError('COMPUTE_ERROR', `${label}.direction must be "asc" or "desc"`);
    }
    direction = rawDirection;
  }

  let ascendingDirection: 'asc' | 'desc' | undefined;
  if (hasAscending) {
    if (typeof rawAscending !== 'boolean') {
      throw new KernelError('COMPUTE_ERROR', `${label}.ascending must be a boolean`);
    }
    ascendingDirection = rawAscending ? 'asc' : 'desc';
  }

  if (direction && ascendingDirection && direction !== ascendingDirection) {
    throw new KernelError('COMPUTE_ERROR', `${label}.direction conflicts with ${label}.ascending`);
  }

  return direction ?? ascendingDirection ?? 'asc';
}

function assertSupportedOfficeSortExtras(
  field: SortFieldRecord,
  label: string,
  options: { allowOfficeColorSort: boolean },
): void {
  if (field.subField !== undefined) {
    throw new KernelError('COMPUTE_ERROR', `${label}.subField rich-value sorting is not supported`);
  }
  if (field.icon !== undefined) {
    throw new KernelError('COMPUTE_ERROR', `${label}.icon sorting is not supported`);
  }
  const sortOn = normalizeOfficeSortOn(field.sortOn, label);
  if (sortOn != null && sortOn !== 'value' && !options.allowOfficeColorSort) {
    throw new KernelError(
      'COMPUTE_ERROR',
      `${label}.sortOn "${String(field.sortOn)}" is not supported; value sorting is supported`,
    );
  }
  if (field.dataOption !== undefined) {
    const dataOption = String(field.dataOption).toLowerCase();
    if (dataOption !== 'normal') {
      throw new KernelError(
        'COMPUTE_ERROR',
        `${label}.dataOption "${String(field.dataOption)}" is not supported`,
      );
    }
  }
  const colorSortRequested =
    sortOn === 'cellColor' ||
    sortOn === 'fontColor' ||
    field.sortBy === 'cellColor' ||
    field.sortBy === 'fontColor';
  if (field.color !== undefined && !colorSortRequested) {
    throw new KernelError(
      'COMPUTE_ERROR',
      `${label}.color requires OfficeJS sortOn "CellColor" or "FontColor", or a Mog color sort descriptor with sortBy, targetColor, and colorPosition`,
    );
  }
}

function normalizeOfficeSortOn(value: unknown, label: string): OfficeSortOn | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new KernelError('COMPUTE_ERROR', `${label}.sortOn must be a string`);
  }
  const normalized = value.toLowerCase();
  if (normalized === 'value') return 'value';
  if (normalized === 'cellcolor') return 'cellColor';
  if (normalized === 'fontcolor') return 'fontColor';
  if (normalized === 'icon') {
    throw new KernelError('COMPUTE_ERROR', `${label}.icon sorting is not supported`);
  }
  throw new KernelError(
    'COMPUTE_ERROR',
    `${label}.sortOn "${value}" is not supported; value, cell color, and font color sorting are supported`,
  );
}

function normalizeRangeSortOrientation(value: unknown, context: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string') {
    throw new KernelError('COMPUTE_ERROR', `${context}.orientation must be "Rows"`);
  }
  if (value.toLowerCase() !== 'rows') {
    throw new KernelError(
      'COMPUTE_ERROR',
      `${context}.orientation "${value}" is not supported; row sorting is supported`,
    );
  }
}

function rejectExplicitSortMethod(value: unknown, context: string): void {
  if (value === undefined) return;
  throw new KernelError('COMPUTE_ERROR', `${context}.method "${String(value)}" is not supported`);
}

function normalizeOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new KernelError('COMPUTE_ERROR', `${label} must be a boolean`);
  }
  return value;
}

function normalizeRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new KernelError('COMPUTE_ERROR', `${label} must be a non-empty string`);
  }
  return value;
}

function normalizeColorPosition(value: unknown, label: string): 'top' | 'bottom' {
  if (value !== 'top' && value !== 'bottom') {
    throw new KernelError('COMPUTE_ERROR', `${label} must be "top" or "bottom"`);
  }
  return value;
}

function normalizeCustomList(value: unknown, index: number): CellValue[] {
  if (!Array.isArray(value)) {
    throw new KernelError(
      'COMPUTE_ERROR',
      `sortRange.columns[${index}].customList must be an array`,
    );
  }
  return value as CellValue[];
}

function isRecord(value: unknown): value is SortFieldRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
