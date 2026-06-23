import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

import type { ConflictDetailSuccess } from './version-merge-review-endpoints-helpers-types';

export function resolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected conflict to expose ${kind} resolution option`);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

export function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:'))
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

export function stableOptionIds(
  options: readonly {
    readonly conflictId: string;
    readonly optionId: string;
    readonly kind: string;
  }[],
): readonly string[] {
  return options
    .map((option) => `${option.kind}\u0000${option.conflictId}\u0000${option.optionId}`)
    .sort();
}

export function expectStableConflictOptions(
  left: ConflictDetailSuccess,
  right: ConflictDetailSuccess,
) {
  expect(left.value.conflictId).toBe(right.value.conflictId);
  expect(left.value.conflictDigest).toBe(right.value.conflictDigest);
  expect(stableOptionIds(left.value.resolutionOptions)).toEqual(
    stableOptionIds(right.value.resolutionOptions),
  );
}

export function formulaConflict(input: {
  readonly result: number;
  readonly conflictIdDigit: string;
}): VersionMergeConflict {
  const structural = metadata('legacy-formula-conflict', 'sheet-1!A1', 'cells.values', ['value']);
  const base = diffValue(null);
  const ours = diffValue({ kind: 'formula', formula: '=1+1', result: input.result });
  const theirs = diffValue('literal');
  return conflictRecord(input.conflictIdDigit, structural, base, ours, theirs);
}

// prettier-ignore
export function rowColumnConflict(input: { readonly conflictIdDigit: string; readonly fields: readonly { readonly key: string; readonly value: VersionSemanticValue }[] }): VersionMergeConflict {
  const structural = metadata('legacy-row-column-conflict', 'sheet-1!row:4', 'rows-columns', ['order']);
  return conflictRecord(input.conflictIdDigit, structural, diffValue(null), diffValue({ kind: 'object', fields: input.fields }), diffValue('manual-order'));
}

export function redactedStructuralConflict(): VersionMergeConflict {
  return {
    ...rowColumnConflict({ conflictIdDigit: '6', fields: rowColumnFields('row', 4) }),
    structural: { kind: 'redacted', reason: 'redaction-policy' } as any,
  };
}

// prettier-ignore
export function rowColumnFields(axis: 'row' | 'column', index: number): readonly { readonly key: string; readonly value: VersionSemanticValue }[] {
  return [
    { key: 'axis', value: axis },
    { key: 'displayRef', value: axis === 'row' ? '5:5' : 'E:E' },
    { key: 'index', value: index },
    { key: 'sheetId', value: 'sheet-1' },
  ];
}

// prettier-ignore
function conflictRecord(digit: string, structural: VersionDiffStructuralMetadata, base: VersionDiffValue, ours: VersionDiffValue, theirs: VersionDiffValue): VersionMergeConflict {
  const conflictId = `conflict:legacy:${digit}`;
  const conflictDigest = `sha256:${digit.repeat(64)}`;
  return {
    conflictId, conflictDigest, conflictKind: 'same-property', structural, base, ours, theirs,
    resolutionOptions: [
      resolutionOption(conflictId, 'acceptOurs', ours, digit),
      resolutionOption(conflictId, 'acceptTheirs', theirs, digit),
      resolutionOption(conflictId, 'acceptBase', base, digit),
    ],
  };
}

// prettier-ignore
function resolutionOption(conflictId: string, kind: VersionMergeConflict['resolutionOptions'][number]['kind'], value: VersionDiffValue, digit: string): VersionMergeConflict['resolutionOptions'][number] {
  return { optionId: `option:legacy:${kind}:${digit}`, conflictId, kind, value, recalcRequired: true };
}

// prettier-ignore
function metadata(changeId: string, entityId: string, domain: string, propertyPath: readonly string[]): VersionDiffStructuralMetadata {
  return { kind: 'metadata', changeId, domain, entityId, propertyPath };
}

function diffValue(value: VersionSemanticValue): VersionDiffValue {
  return { kind: 'value', value };
}
