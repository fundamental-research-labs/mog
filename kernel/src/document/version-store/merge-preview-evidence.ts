import type {
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictResolutionOptionKind,
  VersionRedactedValue,
} from '@mog-sdk/contracts/api';

import { canonicalJsonStringify } from './merge-apply-intent-store-json';

const SEMANTIC_MERGE_DOMAIN_ORDER = new Map(
  [
    'cell',
    'cells.values',
    'cells.formats.direct',
    'sheet',
    'filters',
    'sorts',
    'named-ranges',
    'tables',
    'comments-notes',
    'conditional-formatting',
    'data-validation',
    'charts.source-range',
    'floating-objects.anchors',
  ].map((domain, index) => [domain, index]),
);

const MERGE_RESOLUTION_OPTION_KINDS = [
  'acceptOurs',
  'acceptTheirs',
  'acceptBase',
] as const satisfies readonly VersionMergeConflictResolutionOptionKind[];

export async function mergeStableStructuralMetadata(
  input: {
    readonly structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>;
    readonly before: VersionDiffValue;
    readonly after: VersionDiffValue;
  },
  other: {
    readonly after: VersionDiffValue;
  },
  status: 'clean' | 'conflict',
): Promise<Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>> {
  const structural = normalizeMergeStructuralMetadata(input.structural);
  const changeId = await stableMergeChangeId(
    status,
    structural,
    input.before,
    semanticValuesEqual(input.after, other.after)
      ? [input.after]
      : [input.after, other.after].sort(compareDiffValues),
  );

  return {
    ...structural,
    changeId,
  };
}

export async function stableMergeConflictIdentity(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  base: VersionDiffValue,
  ours: VersionDiffValue,
  theirs: VersionDiffValue,
): Promise<{ readonly conflictId: string; readonly conflictDigest: string }> {
  const sideValues = [ours, theirs].sort(compareDiffValues);
  const canonical = canonicalJsonStringify({
    schemaVersion: 1,
    conflictKind: 'same-property',
    key: mergePropertyKey(structural),
    base,
    sideValues,
  });
  const conflictIdDigest = await sha256Hex(`mog.version.merge.conflict-id.v1\n${canonical}`);
  const conflictDigest = await sha256Hex(`mog.version.merge.conflict-digest.v1\n${canonical}`);

  return {
    conflictId: `conflict:sha256:${conflictIdDigest}`,
    conflictDigest: `sha256:${conflictDigest}`,
  };
}

export async function stableMergeResolutionOptions(
  identity: { readonly conflictId: string; readonly conflictDigest: string },
  base: VersionDiffValue,
  ours: VersionDiffValue,
  theirs: VersionDiffValue,
): Promise<readonly VersionMergeConflictResolutionOption[]> {
  const values: Record<VersionMergeConflictResolutionOptionKind, VersionDiffValue> = {
    acceptOurs: ours,
    acceptTheirs: theirs,
    acceptBase: base,
  };

  return Promise.all(
    MERGE_RESOLUTION_OPTION_KINDS.map(async (kind) => ({
      optionId: await stableMergeResolutionOptionId(identity, kind),
      conflictId: identity.conflictId,
      kind,
      value: values[kind],
      recalcRequired: true,
    })),
  );
}

export function compareMergeChanges(left: VersionMergeChange, right: VersionMergeChange): number {
  return compareStructuralMetadata(left.structural, right.structural);
}

export function compareMergeConflicts(
  left: VersionMergeConflict,
  right: VersionMergeConflict,
): number {
  return compareStructuralMetadata(left.structural, right.structural);
}

function normalizeMergeStructuralMetadata(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): Exclude<VersionDiffStructuralMetadata, VersionRedactedValue> {
  if (
    structural.domain === 'cell' ||
    (structural.domain === 'cells.values' &&
      (structural.propertyPath.length === 0 ||
        (structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value')))
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

export function mergePropertyKey(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): string {
  const normalized = normalizeMergeStructuralMetadata(structural);
  return JSON.stringify([normalized.domain, normalized.entityId, normalized.propertyPath]);
}

async function stableMergeChangeId(
  status: 'clean' | 'conflict',
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  base: VersionDiffValue,
  afterValues: readonly VersionDiffValue[],
): Promise<string> {
  const canonical = canonicalJsonStringify({
    schemaVersion: 1,
    status,
    key: mergePropertyKey(structural),
    base,
    afterValues,
  });

  const digest = await sha256Hex(`mog.version.merge.change-id.v1\n${canonical}`);
  return `merge-${status}:sha256:${digest}`;
}

async function stableMergeResolutionOptionId(
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

function compareStructuralMetadata(
  left: VersionDiffStructuralMetadata,
  right: VersionDiffStructuralMetadata,
): number {
  if (hasRedactedValue(left) || hasRedactedValue(right)) return 0;
  return compareStrings(structuralSortKey(left), structuralSortKey(right));
}

function structuralSortKey(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): string {
  const normalized = normalizeMergeStructuralMetadata(structural);
  const rank = SEMANTIC_MERGE_DOMAIN_ORDER.get(normalized.domain) ?? Number.MAX_SAFE_INTEGER;
  return [
    rank.toString().padStart(4, '0'),
    normalized.domain,
    normalized.entityId,
    ...normalized.propertyPath,
  ].join('\u0000');
}

function semanticValuesEqual(left: VersionDiffValue, right: VersionDiffValue): boolean {
  return canonicalDiffValue(left) === canonicalDiffValue(right);
}

function compareDiffValues(left: VersionDiffValue, right: VersionDiffValue): number {
  return compareStrings(canonicalDiffValue(left), canonicalDiffValue(right));
}

function canonicalDiffValue(value: VersionDiffValue): string {
  return canonicalJsonStringify(value);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('WorkbookVersionMergeService requires SHA-256 support');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hasRedactedValue(value: unknown): value is VersionRedactedValue {
  return (
    typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'redacted'
  );
}
