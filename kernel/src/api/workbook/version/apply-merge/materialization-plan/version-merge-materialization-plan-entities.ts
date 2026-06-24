import { parseCellAddress } from '../../../../internal/utils';
import type { RowColumnAxis } from './version-merge-materialization-plan-types';

export type ParsedCellEntity = {
  readonly sheetId: string;
  readonly address: string;
  readonly row: number;
  readonly col: number;
};

export type ParsedRowColumnEntity = {
  readonly sheetId: string;
  readonly axis: RowColumnAxis;
  readonly index: number;
};

export function parseCellEntity(entityId: string): ParsedCellEntity | null {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return null;
  const sheetId = entityId.slice(0, separator);
  const address = entityId.slice(separator + 1);
  const parsed = parseCellAddress(address);
  if (!parsed) return null;
  return { sheetId, address, row: parsed.row, col: parsed.col };
}

export function parseRowColumnEntity(entityId: string): ParsedRowColumnEntity | null {
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
  if (!isSheetIndex(index)) return null;
  return { sheetId, axis, index };
}

export function parseSheetEntity(entityId: string): string | null {
  return entityId.length > 0 && !entityId.includes('!') ? entityId : null;
}

function isSheetIndex(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
