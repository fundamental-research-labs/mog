import type {
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeConflictResolutionOptionKind,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

import {
  normalizeMergeReviewConflicts,
  selectConflictDetailValue,
} from '../version-merge-review-conflicts';

describe('WorkbookVersion merge review conflict normalization', () => {
  it('normalizes stable conflict ordering and rejects unsupported group approval metadata', async () => {
    const formula = formulaConflict({ result: 2, conflictIdDigit: '1' });
    const rowColumn = rowColumnConflict({
      conflictIdDigit: '3',
      fields: rowColumnFields('row', 4),
    });
    const forward = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      formula,
      rowColumn,
    ]);
    const reversed = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      rowColumn,
      formula,
    ]);
    if (!forward.ok || !reversed.ok) throw new Error('expected conflict normalization success');

    expect(forward.conflictSet.conflicts.map((conflict) => conflict.conflictId)).toEqual(
      reversed.conflictSet.conflicts.map((conflict) => conflict.conflictId),
    );

    const grouped = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      {
        ...formula,
        groupId: 'group:secret-cross-owner',
        groupDigest: { algorithm: 'sha256', digest: 'a'.repeat(64) },
        ownerApprovals: [{ owner: 'owner-secret', status: 'approved' }],
      },
    ]);
    expect(grouped).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_INVALID_COMMIT_PAYLOAD' })],
    });
    expectNoDiagnosticLeaks(grouped, ['group:secret-cross-owner', 'owner-secret']);
  });

  it('rejects resolution options that are not bound to their source conflict', async () => {
    const conflict = formulaConflict({ result: 2, conflictIdDigit: '1' });
    const result = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      {
        ...conflict,
        resolutionOptions: conflict.resolutionOptions.map((option) =>
          option.kind === 'acceptTheirs'
            ? { ...option, conflictId: 'conflict:legacy:other-secret' }
            : option,
        ),
      },
    ]);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_INVALID_COMMIT_PAYLOAD' })],
    });
    expectNoDiagnosticLeaks(result, ['conflict:legacy:other-secret']);
  });

  it('denies redacted conflict values as resolution payload detail', async () => {
    const normalized = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      redactedValueConflict(),
    ]);
    if (!normalized.ok) throw new Error('expected redacted conflict normalization success');
    const conflict = normalized.conflictSet.conflicts[0];
    const option = conflict.resolutionOptions.find(
      (candidate) => candidate.kind === 'acceptTheirs',
    );
    if (!option) throw new Error('expected acceptTheirs option');

    const review = selectConflictDetailValue(
      'getMergeConflictDetail',
      normalized.conflictSet,
      conflict,
      { valueRole: 'theirs', purpose: 'review' },
    );
    expect(review).toMatchObject({
      ok: true,
      value: { kind: 'redacted', reason: 'permission-denied' },
    });

    const payload = selectConflictDetailValue(
      'getMergeConflictDetail',
      normalized.conflictSet,
      conflict,
      {
        valueRole: 'resolved',
        purpose: 'resolution',
        optionId: option.optionId,
        kind: option.kind,
      },
    );
    expect(payload).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_PERMISSION_DENIED' })],
    });
    expectNoDiagnosticLeaks(payload, [conflict.conflictId, option.optionId]);
  });
});

function formulaConflict(input: {
  readonly result: number;
  readonly conflictIdDigit: string;
}): VersionMergeConflict {
  const structural = metadata('legacy-formula-conflict', 'sheet-1!A1', 'cells.values', ['value']);
  const base = diffValue(null);
  const ours = diffValue({ kind: 'formula', formula: '=1+1', result: input.result });
  const theirs = diffValue('literal');
  return conflictRecord(input.conflictIdDigit, structural, base, ours, theirs);
}

function rowColumnConflict(input: {
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

function redactedValueConflict(): VersionMergeConflict {
  const structural = metadata('legacy-redacted-conflict', 'sheet-1!B1', 'cells.values', ['value']);
  return conflictRecord('9', structural, diffValue('base'), diffValue('ours'), {
    kind: 'redacted',
    reason: 'permission-denied',
  });
}

function conflictRecord(
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

function rowColumnFields(
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

function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}
