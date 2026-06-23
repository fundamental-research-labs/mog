import type { VersionDiffValue, VersionSemanticValue } from '@mog-sdk/contracts/api';

import { isRecord } from './merge-service-semantic-record-validation-guards';

export type RowColumnAxis = 'row' | 'column';

export type RowColumnTarget = {
  readonly sheetId: string;
  readonly axis: RowColumnAxis;
  readonly index: number;
};

type RowColumnMergeValue =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'present';
      readonly sheetId: string;
      readonly axis: RowColumnAxis;
      readonly index: number;
    };

export function parseRowColumnEntity(entityId: string): RowColumnTarget | null {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return null;
  const sheetId = entityId.slice(0, separator);
  const axisAndIndex = entityId.slice(separator + 1);
  const axisSeparator = axisAndIndex.lastIndexOf(':');
  if (axisSeparator <= 0 || axisSeparator === axisAndIndex.length - 1) return null;
  const rawAxis = axisAndIndex.slice(0, axisSeparator);
  const axis = rawAxis === 'row' || rawAxis === 'column' ? rawAxis : null;
  if (!axis) return null;
  const index = Number(axisAndIndex.slice(axisSeparator + 1));
  if (!Number.isSafeInteger(index) || index < 0) return null;
  return { sheetId, axis, index };
}

export function isSupportedRowColumnTransition(
  change: { readonly before: VersionDiffValue; readonly after: VersionDiffValue },
  target: RowColumnTarget,
): boolean {
  const before = parseRowColumnMergeValue(change.before, target);
  const after = parseRowColumnMergeValue(change.after, target);
  if (!before || !after) return false;
  if (rowColumnValuesEqual(before, after)) return true;
  return (
    (before.kind === 'absent' && after.kind === 'present') ||
    (before.kind === 'present' && after.kind === 'absent')
  );
}

function parseRowColumnMergeValue(
  value: VersionDiffValue,
  target: RowColumnTarget,
): RowColumnMergeValue | null {
  if (value.kind !== 'value') return null;
  if (value.value === null) return { kind: 'absent' };
  const fields = semanticObjectFieldMap(value.value);
  if (!fields) return null;
  if (
    fields.get('axis') !== target.axis ||
    fields.get('sheetId') !== target.sheetId ||
    fields.get('index') !== target.index
  ) {
    return null;
  }
  return { kind: 'present', sheetId: target.sheetId, axis: target.axis, index: target.index };
}

function rowColumnValuesEqual(left: RowColumnMergeValue, right: RowColumnMergeValue): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'absent' || right.kind === 'absent') return true;
  return left.sheetId === right.sheetId && left.axis === right.axis && left.index === right.index;
}

function semanticObjectFieldMap(
  value: VersionSemanticValue,
): Map<string, VersionSemanticValue> | null {
  if (!isRecord(value) || value.kind !== 'object' || !Array.isArray(value.fields)) return null;
  const fields = new Map<string, VersionSemanticValue>();
  for (const field of value.fields) {
    if (!isRecord(field) || typeof field.key !== 'string') return null;
    fields.set(field.key, field.value as VersionSemanticValue);
  }
  return fields;
}
