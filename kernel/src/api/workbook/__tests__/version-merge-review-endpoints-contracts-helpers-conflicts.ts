import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeConflictResolutionOptionKind,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

export function resolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = requireResolutionOption(conflict, kind);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

export function requireResolutionOption(
  conflict: VersionMergeConflict,
  kind: VersionMergeConflictResolutionOptionKind,
): VersionMergeConflict['resolutionOptions'][number] {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected ${kind} option`);
  return option;
}

export function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

export function mutateDigest(digest: ObjectDigest): ObjectDigest {
  const first = digest.digest[0] === '0' ? '1' : '0';
  return {
    algorithm: digest.algorithm,
    digest: `${first}${digest.digest.slice(1)}`,
  };
}

export function basicConflict(): VersionMergeConflict {
  const structural = metadata('w8-05-cell-conflict', 'sheet-1!A1', 'cells.values', ['value']);
  return conflictRecord('8', structural, diffValue('base'), diffValue('ours'), diffValue('theirs'));
}

export function multiSheetRangeConflicts(): readonly VersionMergeConflict[] {
  return [
    conflictRecord(
      '1',
      metadata('w8-05-sheet-alpha-range-a1-b2', 'sheet-alpha!A1:B2', 'cells.values', ['value']),
      diffValue('base:alpha:A1:B2'),
      diffValue('ours:alpha:A1:B2'),
      diffValue('theirs:alpha:A1:B2'),
    ),
    conflictRecord(
      '2',
      metadata('w8-05-sheet-beta-range-c3-d4', 'sheet-beta!C3:D4', 'cells.values', ['value']),
      diffValue('base:beta:C3:D4'),
      diffValue('ours:beta:C3:D4'),
      diffValue('theirs:beta:C3:D4'),
    ),
    conflictRecord(
      '3',
      metadata('w8-05-sheet-gamma-range-g2-g8', 'sheet-gamma!G2:G8', 'cells.values', ['value']),
      diffValue('base:gamma:G2:G8'),
      diffValue('ours:gamma:G2:G8'),
      diffValue('theirs:gamma:G2:G8'),
    ),
  ];
}

function conflictRecord(
  digit: string,
  structural: VersionDiffStructuralMetadata,
  base: VersionDiffValue,
  ours: VersionDiffValue,
  theirs: VersionDiffValue,
): VersionMergeConflict {
  const conflictId = `conflict:w8-05:${digit}`;
  const conflictDigest = `sha256:${digit.repeat(64)}`;
  return {
    conflictId,
    conflictDigest,
    conflictKind: 'same-property',
    structural,
    base,
    ours,
    theirs,
    resolutionOptions: [
      resolutionOption(conflictId, 'acceptOurs', ours, digit),
      resolutionOption(conflictId, 'acceptTheirs', theirs, digit),
      resolutionOption(conflictId, 'acceptBase', base, digit),
    ],
  };
}

function resolutionOption(
  conflictId: string,
  kind: VersionMergeConflictResolutionOptionKind,
  value: VersionDiffValue,
  digit: string,
): VersionMergeConflict['resolutionOptions'][number] {
  return {
    optionId: `option:w8-05:${kind}:${digit}`,
    conflictId,
    kind,
    value,
    recalcRequired: true,
  };
}

function metadata(
  changeId: string,
  entityId: string,
  domain: string,
  propertyPath: readonly string[],
): VersionDiffStructuralMetadata {
  return { kind: 'metadata', changeId, domain, entityId, propertyPath };
}

function diffValue(value: VersionSemanticValue): VersionDiffValue {
  return { kind: 'value', value };
}
