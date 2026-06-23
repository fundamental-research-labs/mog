import type { MergeDomainReference } from './version-merge-materializer-support-types';

const MATERIALIZABLE_MERGE_DOMAIN_IDS = new Set([
  'cell',
  'cells.values',
  'cells.formulas',
  'cells.formats.direct',
  'rows-columns',
]);
export const DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND = 'semantic-cell-merge-commit-materializer.v1';
const MATERIALIZABLE_MERGE_DOMAIN_IDS_BY_MATRIX_ROW_ID = new Map([
  ['cell', new Set(['cell', 'cells.values', 'cells.formulas'])],
  ['cells.values', new Set(['cell', 'cells.values'])],
  ['cells.formulas', new Set(['cell', 'cells.values', 'cells.formulas'])],
  ['cells.formats.direct', new Set(['cells.formats', 'cells.formats.direct'])],
  ['rows-columns', new Set(['rows-columns'])],
]);
const UNSUPPORTED_STRUCTURAL_MERGE_MATRIX_ROW_IDS = new Set([
  'sheets',
  'tables',
  'filters.auto-filter',
  'charts.source-range',
  'floating-objects.anchors',
]);
const UNSUPPORTED_STRUCTURAL_MERGE_DOMAIN_IDS = new Set([
  'chart',
  'charts',
  'charts.source-range',
  'column',
  'columns',
  'filter',
  'filters',
  'filters.auto-filter',
  'floating-object',
  'floating-objects',
  'floating-objects.anchors',
  'row',
  'rows',
  'sheet',
  'sheets',
  'table',
  'tables',
]);

export function isMaterializableMergeDomainReference(reference: MergeDomainReference): boolean {
  if (isUnsupportedStructuralMergeDomainId(reference.domainId)) return false;

  if (reference.matrixRowId) {
    if (UNSUPPORTED_STRUCTURAL_MERGE_MATRIX_ROW_IDS.has(reference.matrixRowId)) return false;
    const allowedDomainIds = MATERIALIZABLE_MERGE_DOMAIN_IDS_BY_MATRIX_ROW_ID.get(
      reference.matrixRowId,
    );
    return Boolean(allowedDomainIds?.has(reference.domainId));
  }
  return MATERIALIZABLE_MERGE_DOMAIN_IDS.has(reference.domainId);
}

export function isUnsupportedStructuralMergeDomainId(domainId: string): boolean {
  return UNSUPPORTED_STRUCTURAL_MERGE_DOMAIN_IDS.has(domainId);
}
