import type {
  VersionMergeChange,
  VersionMergeResult,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

import { BASE, OURS, THEIRS, metadata as mergeMetadata } from './version-apply-merge-test-utils';

export function cleanResult(changes: readonly VersionMergeChange[]): VersionMergeResult {
  return {
    status: 'clean',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    changes,
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

export function rowColumnChange(
  changeId: string,
  axis: 'row' | 'column',
  index: number,
  action: 'insert' | 'delete',
): VersionMergeChange {
  const displayRef = axis === 'row' ? `${index + 1}:${index + 1}` : 'C:C';
  const value = semanticObject([
    { key: 'axis', value: axis },
    { key: 'sheetId', value: 'sheet-1' },
    { key: 'index', value: index },
    { key: 'displayRef', value: displayRef },
  ]);
  const present = { kind: 'value' as const, value };
  const absent = { kind: 'value' as const, value: null };
  return {
    structural: mergeMetadata(changeId, `sheet-1!${axis}:${index}`, 'rows-columns', ['order']),
    base: action === 'insert' ? absent : present,
    theirs: action === 'insert' ? present : absent,
    merged: action === 'insert' ? present : absent,
  };
}

export function sheetNameChange(): VersionMergeChange {
  return {
    structural: mergeMetadata('merge-sheet-name', 'sheet-1', 'sheet', ['name']),
    base: { kind: 'value', value: 'Sheet1' },
    theirs: { kind: 'value', value: 'Forecast' },
    merged: { kind: 'value', value: 'Forecast' },
  };
}

export function sheetTabColorChange(): VersionMergeChange {
  return {
    structural: mergeMetadata('merge-sheet-tab-color', 'sheet-1', 'sheet', ['tabColor']),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value: '#33AAFF' },
    merged: { kind: 'value', value: '#33AAFF' },
  };
}

export function sheetNameNoopChange(): VersionMergeChange {
  const value = { kind: 'value' as const, value: 'Sheet1' };
  return {
    ...sheetNameChange(),
    theirs: value,
    merged: value,
  };
}

export function sheetLifecycleChange(): VersionMergeChange {
  const value = semanticObject([
    { key: 'name', value: 'Inserted' },
    { key: 'index', value: 1 },
  ]);
  return {
    structural: mergeMetadata('merge-sheet-create', 'sheet-2', 'sheet', ['sheet']),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
  };
}

export function sheetLifecycleNoopChange(): VersionMergeChange {
  const value = semanticObject([
    { key: 'name', value: 'Inserted' },
    { key: 'index', value: 1 },
  ]);
  return {
    structural: mergeMetadata('merge-sheet-create-noop', 'sheet-2', 'sheet', ['sheet']),
    base: { kind: 'value', value },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
  };
}

export function tableDefinitionChange(): VersionMergeChange {
  const value = semanticObject([
    { key: 'kind', value: 'Added' },
    { key: 'tableId', value: 'table-1' },
    { key: 'name', value: 'SalesTable' },
    { key: 'sheetId', value: 'sheet-1' },
  ]);
  return {
    structural: mergeMetadata('merge-table-definition', 'sheet-1!table:table-1', 'tables', [
      'definition',
    ]),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
  };
}

export function filterStateChange(): VersionMergeChange {
  const value = semanticObject([
    { key: 'kind', value: 'Added' },
    { key: 'sheetId', value: 'sheet-1' },
    { key: 'range', value: 'A1:D20' },
  ]);
  return {
    structural: mergeMetadata('merge-filter-state', 'sheet-1!auto-filter', 'filters', ['state']),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
  };
}

export function chartSourceRangeChange(): VersionMergeChange {
  const value = semanticObject([
    { key: 'objectType', value: 'chart' },
    { key: 'sourceRange', value: 'A1:B12' },
    { key: 'sheetId', value: 'sheet-1' },
  ]);
  return {
    structural: mergeMetadata(
      'merge-chart-source-range',
      'sheet-1!chart:chart-1',
      'charts.source-range',
      ['sourceRange'],
    ),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
  };
}

export function floatingObjectAnchorChange(): VersionMergeChange {
  const value = semanticObject([
    { key: 'objectType', value: 'picture' },
    { key: 'from', value: 'C3' },
    { key: 'to', value: 'F12' },
  ]);
  return {
    structural: mergeMetadata(
      'merge-floating-object-anchor',
      'sheet-1!object:picture-1',
      'floating-objects.anchors',
      ['anchor'],
    ),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
  };
}

function semanticObject(
  fields: readonly { readonly key: string; readonly value: VersionSemanticValue }[],
): VersionSemanticValue {
  return {
    kind: 'object',
    fields,
  };
}
