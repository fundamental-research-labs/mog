import { KernelError } from '../../errors';
import {
  normalizeFormulaA1,
  type NormalizedSetCellsEntry,
  type SetCellsEntry,
  type SetCellsFormulaEntry,
  type SetCellsValueEntry,
} from './formula-api-helpers';

export function normalizeSetCellsEntries(cells: SetCellsEntry[]): NormalizedSetCellsEntry[] {
  return cells.map((cell, index) => {
    const hasValue = Object.prototype.hasOwnProperty.call(cell, 'value');
    const hasFormula = Object.prototype.hasOwnProperty.call(cell, 'formula');
    if (hasValue === hasFormula) {
      throw new KernelError(
        'API_INVALID_ARGUMENT',
        'worksheet.setCells entries must provide exactly one of `value` or `formula`.',
        {
          suggestion:
            'Use { address: "A1", value } for values or { cell: "A1", formula: "=SUM(B1:B3)" } for formulas.',
          context: {
            validationKind: 'ambiguousSetCellsEntry',
            received: cell as Record<string, unknown>,
          },
        },
      );
    }

    const addr = 'cell' in cell ? cell.cell : (cell.addr ?? cell.address);
    const value = hasFormula
      ? normalizeFormulaA1((cell as SetCellsFormulaEntry).formula, 'worksheet.setCells', [
          'cells',
          String(index),
          'formula',
        ])
      : (cell as SetCellsValueEntry).value;
    const annotation = cell.annotation;

    if (addr !== undefined) {
      return { address: addr, value, annotation };
    }
    return {
      row: cell.row,
      col: cell.col,
      value,
      annotation,
    };
  });
}
