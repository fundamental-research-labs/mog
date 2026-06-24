import { PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS } from '@mog-sdk/contracts/versioning';

import { REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS } from '../../../../document/version-store/domain-support-manifest-validator';
import type {
  VersionDomainSupportManifestGateOperation,
  VersionDomainSupportOperationCapabilityMatrixRow,
} from './version-domain-support-gate-types';

const REQUIRED_MANIFEST_OPERATION_CAPABILITY_MATRIX = Object.freeze({
  commit: {
    requiredCapabilityKeys: ['capture', 'persistence'],
    requiredMatrixRowIds: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
    validatorOperation: 'commit',
  },
  diff: {
    requiredCapabilityKeys: ['diff'],
    requiredMatrixRowIds: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  },
  checkout: {
    requiredCapabilityKeys: ['checkout'],
    requiredMatrixRowIds: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
    validatorOperation: 'checkout',
  },
  merge: {
    requiredCapabilityKeys: ['merge'],
    requiredMatrixRowIds: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
    validatorOperation: 'merge',
  },
  applyMerge: {
    requiredCapabilityKeys: ['merge', 'persistence'],
    requiredMatrixRowIds: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
    validatorOperation: 'applyMerge',
  },
  review: {
    requiredCapabilityKeys: ['reviewAccess'],
    requiredMatrixRowIds: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  },
  reviewAccess: {
    requiredCapabilityKeys: ['reviewAccess'],
    requiredMatrixRowIds: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  },
  import: {
    requiredCapabilityKeys: ['import'],
    requiredMatrixRowIds: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  },
  export: {
    requiredCapabilityKeys: ['export'],
    requiredMatrixRowIds: PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS,
    validatorOperation: 'export',
  },
  revert: {
    requiredCapabilityKeys: ['replay', 'persistence'],
    requiredMatrixRowIds: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  },
  undo: {
    requiredCapabilityKeys: ['replay'],
    requiredMatrixRowIds: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  },
  redo: {
    requiredCapabilityKeys: ['replay'],
    requiredMatrixRowIds: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  },
} satisfies Readonly<
  Record<
    VersionDomainSupportManifestGateOperation,
    VersionDomainSupportOperationCapabilityMatrixRow
  >
>);

export function domainSupportOperationCapabilityMatrixRow(
  operation: VersionDomainSupportManifestGateOperation,
): VersionDomainSupportOperationCapabilityMatrixRow | null {
  const row = (
    REQUIRED_MANIFEST_OPERATION_CAPABILITY_MATRIX as Readonly<
      Record<string, VersionDomainSupportOperationCapabilityMatrixRow | undefined>
    >
  )[operation];
  if (!row) return null;
  if (row.requiredCapabilityKeys.length === 0 || row.requiredMatrixRowIds.length === 0) return null;
  if (new Set(row.requiredCapabilityKeys).size !== row.requiredCapabilityKeys.length) return null;
  if (new Set(row.requiredMatrixRowIds).size !== row.requiredMatrixRowIds.length) return null;
  return row;
}
