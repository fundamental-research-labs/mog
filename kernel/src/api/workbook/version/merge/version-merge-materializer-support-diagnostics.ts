import type {
  VersionDiffStructuralMetadata,
  VersionMergeChange,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { canonicalJsonStringify } from '../../../../document/version-store/merge-apply-intent-store-json';
import {
  DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
  isUnsupportedStructuralMergeDomainId,
} from './version-merge-materializer-support-domains';
import type {
  MergeDomainReference,
  MergeMaterializationOperation,
  MergeMaterializationSupport,
} from './version-merge-materializer-support-types';

export function unsupportedDetectedMergeDomainDiagnostic(
  operation: Extract<MergeMaterializationOperation, 'merge' | 'applyMerge'>,
  itemIndex: number,
  reference: MergeDomainReference,
): VersionStoreDiagnostic {
  return unsupportedDiagnostic(
    operation,
    itemIndex,
    {
      ok: false,
      reason: 'unsupportedDetectedDomain',
      structuralKind: 'metadata',
      domain: reference.domainId,
      propertyPath: 'redacted',
    },
    {
      ...(reference.matrixRowId ? { matrixRowId: reference.matrixRowId } : {}),
    },
  );
}

export function unsupported(
  structural: VersionDiffStructuralMetadata,
  reason: string,
  options: { readonly noop?: boolean } = {},
): Extract<MergeMaterializationSupport, { readonly ok: false }> {
  return {
    ok: false,
    reason,
    structuralKind: structural.kind,
    domain: structural.kind === 'metadata' ? structural.domain : 'redacted',
    propertyPath: structural.kind === 'metadata' ? structural.propertyPath.join('.') : 'redacted',
    ...(options.noop === undefined ? {} : { noop: options.noop }),
  };
}

export function unsupportedStructuralReason(structural: VersionDiffStructuralMetadata): string {
  if (structural.kind === 'metadata' && isUnsupportedStructuralMergeDomainId(structural.domain)) {
    return 'unsupportedStructuralDomain';
  }
  return 'unsupportedStructuralMetadata';
}

export function unsupportedDiagnostic(
  operation: MergeMaterializationOperation,
  itemIndex: number,
  support: Extract<MergeMaterializationSupport, { readonly ok: false }>,
  extra: Readonly<Record<string, string | number | boolean | null>> = {},
): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
    severity: 'error',
    recoverability: 'unsupported',
    messageTemplateId: `version.${operation}.VERSION_MERGE_UNSUPPORTED_DOMAIN`,
    safeMessage:
      'This merge plan contains changes that the current merge materializer cannot apply.',
    payload: {
      operation,
      itemIndex,
      materializer: DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
      structuralKind: support.structuralKind,
      domain: support.domain,
      propertyPath: support.propertyPath,
      reason: support.reason,
      ...(support.noop === undefined ? {} : { noop: support.noop }),
      ...extra,
    },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

export function isNoopMergeChange(
  change: Pick<VersionMergeChange, 'merged'> & Partial<Pick<VersionMergeChange, 'base' | 'ours'>>,
): boolean | undefined {
  const before = change.ours ?? change.base;
  if (before === undefined) return undefined;
  return canonicalJsonStringify(before) === canonicalJsonStringify(change.merged);
}
