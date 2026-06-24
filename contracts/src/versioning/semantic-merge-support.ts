export const VERSION_SEMANTIC_MERGE_SUPPORT_MANIFEST_SCHEMA_VERSION =
  'version-semantic-merge-support.v1';

export const VERSION_SEMANTIC_MERGE_MATERIALIZER_KINDS = Object.freeze([
  'semantic-cell-merge-commit-materializer.v1',
] as const);
export type VersionSemanticMergeMaterializerKind =
  (typeof VERSION_SEMANTIC_MERGE_MATERIALIZER_KINDS)[number];

export const DEFAULT_VERSION_SEMANTIC_MERGE_MATERIALIZER_KIND =
  'semantic-cell-merge-commit-materializer.v1' satisfies VersionSemanticMergeMaterializerKind;

export const VERSION_SEMANTIC_DIFF_RAW_PUBLIC_DOMAIN_IDS = Object.freeze([
  'cell',
  'cells.values',
  'cells.formulas',
  'sheet',
  'cells.formats.direct',
  'rows-columns',
] as const);
export type VersionSemanticDiffRawPublicDomainId =
  (typeof VERSION_SEMANTIC_DIFF_RAW_PUBLIC_DOMAIN_IDS)[number];

export const VERSION_SEMANTIC_MERGE_MATERIALIZABLE_DOMAIN_IDS = Object.freeze([
  'cell',
  'cells.values',
  'cells.formulas',
  'cells.formats',
  'cells.formats.direct',
  'rows-columns',
  'sheet',
  'sheets',
] as const);
export type VersionSemanticMergeMaterializableDomainId =
  (typeof VERSION_SEMANTIC_MERGE_MATERIALIZABLE_DOMAIN_IDS)[number];

export const VERSION_SEMANTIC_MERGE_MATERIALIZABLE_DOMAIN_IDS_BY_MATRIX_ROW_ID = Object.freeze({
  cell: Object.freeze(['cell', 'cells.values', 'cells.formulas'] as const),
  'cells.values': Object.freeze(['cell', 'cells.values'] as const),
  'cells.formulas': Object.freeze(['cell', 'cells.values', 'cells.formulas'] as const),
  'cells.formats.direct': Object.freeze(['cells.formats', 'cells.formats.direct'] as const),
  'rows-columns': Object.freeze(['rows-columns'] as const),
  sheets: Object.freeze(['sheet', 'sheets'] as const),
} as const);
export type VersionSemanticMergeMaterializableMatrixRowId =
  keyof typeof VERSION_SEMANTIC_MERGE_MATERIALIZABLE_DOMAIN_IDS_BY_MATRIX_ROW_ID;
export type VersionSemanticMergeMatrixRowDomainMap =
  typeof VERSION_SEMANTIC_MERGE_MATERIALIZABLE_DOMAIN_IDS_BY_MATRIX_ROW_ID;

export const VERSION_SEMANTIC_MERGE_UNSUPPORTED_STRUCTURAL_MATRIX_ROW_IDS = Object.freeze([
  'tables',
  'filters.auto-filter',
  'charts.source-range',
  'floating-objects.anchors',
] as const);
export type VersionSemanticMergeUnsupportedStructuralMatrixRowId =
  (typeof VERSION_SEMANTIC_MERGE_UNSUPPORTED_STRUCTURAL_MATRIX_ROW_IDS)[number];
export type VersionSemanticMergeUnsupportedMatrixRowIds =
  readonly VersionSemanticMergeUnsupportedStructuralMatrixRowId[];

export const VERSION_SEMANTIC_MERGE_UNSUPPORTED_STRUCTURAL_DOMAIN_IDS = Object.freeze([
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
  'table',
  'tables',
] as const);
export type VersionSemanticMergeUnsupportedStructuralDomainId =
  (typeof VERSION_SEMANTIC_MERGE_UNSUPPORTED_STRUCTURAL_DOMAIN_IDS)[number];
export type VersionSemanticMergeUnsupportedDomainIds =
  readonly VersionSemanticMergeUnsupportedStructuralDomainId[];

export interface VersionSemanticMergeSupportManifest {
  readonly schemaVersion: typeof VERSION_SEMANTIC_MERGE_SUPPORT_MANIFEST_SCHEMA_VERSION;
  readonly defaultMaterializerKind: VersionSemanticMergeMaterializerKind;
  readonly rawPublicDiffDomainIds: readonly VersionSemanticDiffRawPublicDomainId[];
  readonly materializableDomainIds: readonly VersionSemanticMergeMaterializableDomainId[];
  readonly materializableDomainIdsByMatrixRowId: VersionSemanticMergeMatrixRowDomainMap;
  readonly unsupportedStructuralMatrixRowIds: VersionSemanticMergeUnsupportedMatrixRowIds;
  readonly unsupportedStructuralDomainIds: VersionSemanticMergeUnsupportedDomainIds;
}

export const VERSION_SEMANTIC_MERGE_SUPPORT_MANIFEST = Object.freeze({
  schemaVersion: VERSION_SEMANTIC_MERGE_SUPPORT_MANIFEST_SCHEMA_VERSION,
  defaultMaterializerKind: DEFAULT_VERSION_SEMANTIC_MERGE_MATERIALIZER_KIND,
  rawPublicDiffDomainIds: VERSION_SEMANTIC_DIFF_RAW_PUBLIC_DOMAIN_IDS,
  materializableDomainIds: VERSION_SEMANTIC_MERGE_MATERIALIZABLE_DOMAIN_IDS,
  materializableDomainIdsByMatrixRowId:
    VERSION_SEMANTIC_MERGE_MATERIALIZABLE_DOMAIN_IDS_BY_MATRIX_ROW_ID,
  unsupportedStructuralMatrixRowIds: VERSION_SEMANTIC_MERGE_UNSUPPORTED_STRUCTURAL_MATRIX_ROW_IDS,
  unsupportedStructuralDomainIds: VERSION_SEMANTIC_MERGE_UNSUPPORTED_STRUCTURAL_DOMAIN_IDS,
} satisfies VersionSemanticMergeSupportManifest);
