import { cellId, colId, rowId, toCellId, toColId, toRowId } from '@mog-sdk/contracts/cell-identity';

const checks = [
  ['cellId', cellId, 'cell-fixture'],
  ['toCellId', toCellId, 'cell-fixture'],
  ['rowId', rowId, 'row-fixture'],
  ['toRowId', toRowId, 'row-fixture'],
  ['colId', colId, 'col-fixture'],
  ['toColId', toColId, 'col-fixture'],
];

for (const [name, fn, input] of checks) {
  if (typeof fn !== 'function') {
    throw new Error(`${name} must be a runtime function`);
  }
  if (fn(input) !== input) {
    throw new Error(`${name} must return the branded input value`);
  }
}
