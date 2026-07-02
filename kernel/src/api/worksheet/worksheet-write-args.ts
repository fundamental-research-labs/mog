import type { CellRange } from '@mog-sdk/contracts/api';

import { KernelError } from '../../errors';
import { parseCellAddress, parseCellRange } from '../internal/utils';

export type MatrixWriteArgs<TValues> = {
  startRow: number;
  startCol: number;
  values: TValues;
};

export function resolveMatrixWriteArgs<TValues>(
  a: string | number | CellRange,
  b: unknown,
  c?: unknown,
): MatrixWriteArgs<TValues> {
  if (typeof a === 'object') {
    return {
      startRow: a.startRow,
      startCol: a.startCol,
      values: b as TValues,
    };
  }

  if (typeof a === 'string') {
    const parsed = parseCellRange(a);
    if (parsed) {
      return {
        startRow: parsed.startRow,
        startCol: parsed.startCol,
        values: b as TValues,
      };
    }

    const cell = parseCellAddress(a);
    if (!cell) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${a}"`);
    return {
      startRow: cell.row,
      startCol: cell.col,
      values: b as TValues,
    };
  }

  return {
    startRow: a,
    startCol: b as number,
    values: c as TValues,
  };
}
