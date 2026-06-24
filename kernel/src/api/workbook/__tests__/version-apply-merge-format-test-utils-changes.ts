import type {
  VersionMergeChange,
  VersionMergeResult,
  VersionSemanticValue,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

export function cleanMergeResult(
  base: WorkbookCommitId,
  ours: WorkbookCommitId,
  theirs: WorkbookCommitId,
  changes: readonly VersionMergeChange[],
): VersionMergeResult {
  return {
    status: 'clean',
    base,
    ours,
    theirs,
    changes,
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

export function formulaChange(
  changeId: string,
  sheetId: string,
  address: string,
  formula: string,
): VersionMergeChange {
  const value: VersionSemanticValue = { kind: 'formula', formula };
  return {
    structural: metadata(changeId, `${sheetId}!${address}`, 'cells.formulas', ['formula']),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
    display: { address: { kind: 'value', value: address } },
  };
}

export function rowColumnChange(
  changeId: string,
  sheetId: string,
  axis: 'row' | 'column',
  index: number,
  action: 'insert' | 'delete',
): VersionMergeChange {
  const value = rowColumnValue(sheetId, axis, index);
  const present = { kind: 'value' as const, value };
  const absent = { kind: 'value' as const, value: null };
  return {
    structural: metadata(changeId, `${sheetId}!${axis}:${index}`, 'rows-columns', ['order']),
    base: action === 'insert' ? absent : present,
    theirs: action === 'insert' ? present : absent,
    merged: action === 'insert' ? present : absent,
    display: { address: { kind: 'value', value: displayRef(axis, index) } },
  };
}

export function sheetMetadataChange(
  changeId: string,
  sheetId: string,
  property: 'name',
  base: string,
  value: string,
): VersionMergeChange;
export function sheetMetadataChange(
  changeId: string,
  sheetId: string,
  property: 'tabColor',
  base: string | null,
  value: string | null,
): VersionMergeChange;
export function sheetMetadataChange(
  changeId: string,
  sheetId: string,
  property: 'frozen',
  base: { readonly rows: number; readonly cols: number },
  value: { readonly rows: number; readonly cols: number },
): VersionMergeChange;
export function sheetMetadataChange(
  changeId: string,
  sheetId: string,
  property: 'name' | 'tabColor' | 'frozen',
  base: string | null | { readonly rows: number; readonly cols: number },
  value: string | null | { readonly rows: number; readonly cols: number },
): VersionMergeChange {
  return {
    structural: metadata(changeId, sheetId, 'sheet', [property]),
    base: { kind: 'value', value: sheetMetadataValue(base) },
    theirs: { kind: 'value', value: sheetMetadataValue(value) },
    merged: { kind: 'value', value: sheetMetadataValue(value) },
  };
}

function sheetMetadataValue(
  value: string | null | { readonly rows: number; readonly cols: number },
): VersionSemanticValue {
  if (typeof value === 'object' && value !== null && 'rows' in value && 'cols' in value) {
    return {
      kind: 'object',
      fields: [
        { key: 'rows', value: value.rows },
        { key: 'cols', value: value.cols },
      ],
    };
  }
  return value;
}

function rowColumnValue(
  sheetId: string,
  axis: 'row' | 'column',
  index: number,
): VersionSemanticValue {
  return {
    kind: 'object',
    fields: [
      { key: 'axis', value: axis },
      { key: 'sheetId', value: sheetId },
      { key: 'index', value: index },
      { key: 'displayRef', value: displayRef(axis, index) },
    ],
  };
}

function displayRef(axis: 'row' | 'column', index: number): string {
  if (axis === 'row') {
    const label = String(index + 1);
    return `${label}:${label}`;
  }
  const label = columnLabel(index);
  return `${label}:${label}`;
}

function columnLabel(index: number): string {
  let remaining = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

function metadata(
  changeId: string,
  entityId: string,
  domain: string,
  propertyPath: readonly string[],
) {
  return {
    kind: 'metadata' as const,
    changeId,
    domain,
    entityId,
    propertyPath,
  };
}
