import type { VersionDomainCapabilityKey } from '@mog-sdk/contracts/versioning';

import type { DomainSupportManifestValidationOperation } from './domain-support-manifest-validator-types';

/**
 * Schema versions this validator understands. A manifest tagged with anything
 * outside this set is rejected (fail-closed) rather than best-effort parsed.
 */
export const SUPPORTED_DOMAIN_SUPPORT_MANIFEST_SCHEMA_VERSIONS = Object.freeze([
  '2',
  'domain-support-manifest.v2',
] as const);

/**
 * First-slice domains that MUST be present in every manifest before a durable
 * operation can proceed. A manifest that omits any of these fails closed: we
 * cannot prove coverage for a domain we have no row for. Kept in sync with the
 * coverage matrix / BatchBDomainInventory first-slice set.
 */
export const REQUIRED_FIRST_SLICE_DOMAIN_IDS = Object.freeze([
  'workbook-metadata',
  'sheets',
  'rows-columns',
  'cells.values',
  'cells.formulas',
  'recalc-caches',
] as const);

/**
 * Support policy rows are keyed by matrix row, not by broad domain family. The
 * current first slice happens to use row ids equal to domain ids, but subtype
 * rows such as cells.formats.direct must be represented independently.
 */
export const REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS = Object.freeze([
  'workbook-metadata',
  'sheets',
  'rows-columns',
  'cells.values',
  'cells.formulas',
  'recalc-caches',
] as const);

export const REQUIRED_CAPABILITY_KEYS_BY_OPERATION = Object.freeze({
  commit: ['capture', 'persistence'],
  checkout: ['checkout'],
  merge: [],
  applyMerge: ['persistence'],
  export: ['export'],
} satisfies Readonly<
  Record<DomainSupportManifestValidationOperation, readonly VersionDomainCapabilityKey[]>
>);
