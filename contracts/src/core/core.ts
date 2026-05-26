export type * from '@mog/types-core/core';
import type { RangeId, SheetId } from '@mog/types-core/core';

/** Maximum rows in a sheet (Excel limit: 1,048,576). */
export const MAX_ROWS = 1_048_576;

/** Maximum columns in a sheet (Excel limit: 16,384 = XFD). */
export const MAX_COLS = 16_384;

/** Construct a branded SheetId from a raw string. */
export function sheetId(id: string): SheetId {
  return id as SheetId;
}

/** Construct a branded RangeId from a raw string. */
export function rangeId(id: string): RangeId {
  return id as RangeId;
}

/** Semantic role of a range; matches Rust RangeKind. */
export enum RangeKind {
  Data = 'Data',
  Format = 'Format',
  NamedRange = 'NamedRange',
  CondFormat = 'CondFormat',
  Validation = 'Validation',
  Protection = 'Protection',
  PrintArea = 'PrintArea',
  Table = 'Table',
}
