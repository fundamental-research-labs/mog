import {
  DEFAULT_VERSION_SEMANTIC_MERGE_MATERIALIZER_KIND,
  VERSION_SEMANTIC_MERGE_MATERIALIZABLE_DOMAIN_IDS,
  VERSION_SEMANTIC_MERGE_MATERIALIZABLE_DOMAIN_IDS_BY_MATRIX_ROW_ID,
  VERSION_SEMANTIC_MERGE_UNSUPPORTED_STRUCTURAL_DOMAIN_IDS,
  VERSION_SEMANTIC_MERGE_UNSUPPORTED_STRUCTURAL_MATRIX_ROW_IDS,
} from '@mog-sdk/contracts/versioning';

import type { MergeDomainReference } from './version-merge-materializer-support-types';

const MATERIALIZABLE_MERGE_DOMAIN_IDS: ReadonlySet<string> = new Set<string>(
  VERSION_SEMANTIC_MERGE_MATERIALIZABLE_DOMAIN_IDS,
);
export const DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND =
  DEFAULT_VERSION_SEMANTIC_MERGE_MATERIALIZER_KIND;
const MATERIALIZABLE_MERGE_DOMAIN_IDS_BY_MATRIX_ROW_ID: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map(
  Object.entries(VERSION_SEMANTIC_MERGE_MATERIALIZABLE_DOMAIN_IDS_BY_MATRIX_ROW_ID).map(
    ([matrixRowId, domainIds]) => [matrixRowId, new Set<string>(domainIds)] as const,
  ),
);
const UNSUPPORTED_STRUCTURAL_MERGE_MATRIX_ROW_IDS: ReadonlySet<string> = new Set<string>(
  VERSION_SEMANTIC_MERGE_UNSUPPORTED_STRUCTURAL_MATRIX_ROW_IDS,
);
const UNSUPPORTED_STRUCTURAL_MERGE_DOMAIN_IDS: ReadonlySet<string> = new Set<string>(
  VERSION_SEMANTIC_MERGE_UNSUPPORTED_STRUCTURAL_DOMAIN_IDS,
);

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
