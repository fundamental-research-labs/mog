import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

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
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

export function conflictRecord(digit: string): VersionMergeConflict {
  const structural = metadata('object-corruption-conflict', 'sheet-1!A1', 'cell', ['value']);
  const base = diffValue('base');
  const ours = diffValue('ours');
  const theirs = diffValue('theirs');
  const conflictId = `conflict:object-corruption:${digit}`;
  return {
    conflictId,
    conflictDigest: `sha256:${digit.repeat(64)}`,
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
  kind: VersionMergeConflict['resolutionOptions'][number]['kind'],
  value: VersionDiffValue,
  digit: string,
): VersionMergeConflict['resolutionOptions'][number] {
  return {
    optionId: `option:object-corruption:${kind}:${digit}`,
    conflictId,
    kind,
    value,
    recalcRequired: false,
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
