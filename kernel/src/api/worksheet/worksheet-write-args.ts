import type { CellRange, RangeWriteOptions } from '@mog-sdk/contracts/api';

import { KernelError } from '../../errors';
import { parseCellAddress, parseCellRange } from '../internal/utils';

export type MatrixWriteArgs<TValues> = {
  startRow: number;
  startCol: number;
  values: TValues;
  options: RangeWriteOptions | undefined;
};

export function resolveMatrixWriteArgs<TValues>(
  a: string | number | CellRange,
  b: unknown,
  c?: unknown,
  d?: RangeWriteOptions,
): MatrixWriteArgs<TValues> {
  if (typeof a === 'object') {
    return {
      startRow: a.startRow,
      startCol: a.startCol,
      values: b as TValues,
      options: c as RangeWriteOptions | undefined,
    };
  }

  if (typeof a === 'string') {
    const parsed = parseCellRange(a);
    if (parsed) {
      return {
        startRow: parsed.startRow,
        startCol: parsed.startCol,
        values: b as TValues,
        options: c as RangeWriteOptions | undefined,
      };
    }

    const cell = parseCellAddress(a);
    if (!cell) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${a}"`);
    return {
      startRow: cell.row,
      startCol: cell.col,
      values: b as TValues,
      options: c as RangeWriteOptions | undefined,
    };
  }

  return {
    startRow: a,
    startCol: b as number,
    values: c as TValues,
    options: d,
  };
}
