import type {
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflictResolutionOptionKind,
  VersionRedactedValue,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

import { canonicalJsonStringify } from '../../../../document/version-store/merge-apply-intent-store-json';
import {
  compareJsonValues,
  compareSemanticFields,
  isRecord,
} from './version-merge-review-conflicts-projection';

export async function stableReviewConflictIdentity(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  base: VersionDiffValue,
  ours: VersionDiffValue,
  theirs: VersionDiffValue,
): Promise<{ readonly conflictId: string; readonly conflictDigest: string }> {
  const sideValues = [identityDiffValue(ours), identityDiffValue(theirs)].sort(compareJsonValues);
  const canonical = canonicalJsonStringify({
    schemaVersion: 1,
    conflictKind: 'same-property',
    key: mergeReviewPropertyKey(structural),
    base: identityDiffValue(base),
    sideValues,
  });
  const conflictIdDigest = await sha256Hex(`mog.version.merge.conflict-id.v1\n${canonical}`);
  const conflictDigest = await sha256Hex(`mog.version.merge.conflict-digest.v1\n${canonical}`);
  return {
    conflictId: `conflict:sha256:${conflictIdDigest}`,
    conflictDigest: `sha256:${conflictDigest}`,
  };
}

export async function stableReviewResolutionOptionId(
  identity: { readonly conflictId: string; readonly conflictDigest: string },
  kind: VersionMergeConflictResolutionOptionKind,
): Promise<string> {
  const canonical = canonicalJsonStringify({
    schemaVersion: 1,
    conflictId: identity.conflictId,
    conflictDigest: identity.conflictDigest,
    kind,
  });
  const digest = await sha256Hex(`mog.version.merge.resolution-option-id.v1\n${canonical}`);
  return `option:sha256:${digest}`;
}

function mergeReviewPropertyKey(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): string {
  const normalized = normalizeReviewStructuralMetadata(structural);
  return JSON.stringify([normalized.domain, normalized.entityId, normalized.propertyPath]);
}

function normalizeReviewStructuralMetadata(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): Exclude<VersionDiffStructuralMetadata, VersionRedactedValue> {
  if (
    structural.domain === 'cell' ||
    (structural.domain === 'cells.values' &&
      (structural.propertyPath.length === 0 ||
        (structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value'))) ||
    (structural.domain === 'cells.formulas' &&
      (structural.propertyPath.length === 0 ||
        (structural.propertyPath.length === 1 && structural.propertyPath[0] === 'formula')))
  ) {
    return {
      kind: 'metadata',
      changeId: structural.changeId,
      domain: 'cells.values',
      entityId: structural.entityId,
      propertyPath: ['value'],
    };
  }

  return {
    kind: 'metadata',
    changeId: structural.changeId,
    domain: structural.domain,
    entityId: structural.entityId,
    propertyPath: [...structural.propertyPath],
  };
}

function identityDiffValue(value: VersionDiffValue): VersionDiffValue {
  return value.kind === 'value'
    ? { kind: 'value', value: identitySemanticValue(value.value) }
    : value;
}

function identitySemanticValue(value: VersionSemanticValue): VersionSemanticValue {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'formula':
      return { kind: 'formula', formula: value.formula };
    case 'array':
      return { kind: 'array', values: value.values.map(identitySemanticValue) };
    case 'object':
      return {
        kind: 'object',
        fields: value.fields
          .map((field) => ({ key: field.key, value: identitySemanticValue(field.value) }))
          .sort(compareSemanticFields),
      };
    default:
      return value;
  }
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('WorkbookVersion merge review requires SHA-256 support');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
