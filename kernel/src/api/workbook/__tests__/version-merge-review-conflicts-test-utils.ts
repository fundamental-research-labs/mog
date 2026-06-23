import type {
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeConflictResolutionOptionKind,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

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

export function rowColumnConflict(input: {
  readonly conflictIdDigit: string;
  readonly fields: readonly { readonly key: string; readonly value: VersionSemanticValue }[];
}): VersionMergeConflict {
  const structural = metadata('legacy-row-column-conflict', 'sheet-1!row:4', 'rows-columns', [
    'order',
  ]);
  return conflictRecord(
    input.conflictIdDigit,
    structural,
    diffValue(null),
    diffValue({ kind: 'object', fields: input.fields }),
    diffValue('manual-order'),
  );
}

export function redactedValueConflict(): VersionMergeConflict {
  const structural = metadata('legacy-redacted-conflict', 'sheet-1!B1', 'cells.values', ['value']);
  return conflictRecord('9', structural, diffValue('base'), diffValue('ours'), {
    kind: 'redacted',
    reason: 'permission-denied',
  });
}

export function conflictRecord(
  digit: string,
  structural: VersionDiffStructuralMetadata,
  base: VersionDiffValue,
  ours: VersionDiffValue,
  theirs: VersionDiffValue,
): VersionMergeConflict {
  const conflictId = `conflict:legacy:${digit}`;
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

export function metadata(
  changeId: string,
  entityId: string,
  domain: string,
  propertyPath: readonly string[],
): VersionDiffStructuralMetadata {
  return { kind: 'metadata', changeId, domain, entityId, propertyPath };
}

export function diffValue(value: VersionSemanticValue): VersionDiffValue {
  return { kind: 'value', value };
}

export function rowColumnFields(
  axis: 'row' | 'column',
  index: number,
): readonly { readonly key: string; readonly value: VersionSemanticValue }[] {
  return [
    { key: 'axis', value: axis },
    { key: 'displayRef', value: axis === 'row' ? '5:5' : 'E:E' },
    { key: 'index', value: index },
    { key: 'sheetId', value: 'sheet-1' },
  ];
}

export function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}

function resolutionOption(
  conflictId: string,
  kind: VersionMergeConflictResolutionOptionKind,
  value: VersionDiffValue,
  digit: string,
): VersionMergeConflict['resolutionOptions'][number] {
  return {
    optionId: `option:legacy:${kind}:${digit}`,
    conflictId,
    kind,
    value,
    recalcRequired: true,
  };
}
