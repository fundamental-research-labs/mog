import { describe, expect, it, jest } from '@jest/globals';

import type {
  VersionDiffEntry,
  VersionDiffValue,
  VersionMergeChange,
  VersionMergeConflict,
  WorkbookCommitSummary,
  WorkbookVersionReviewDiffChange,
} from '@mog-sdk/contracts/api';

import {
  DEFAULT_TIMELINE_STYLE,
  WorkbookTimelineStylesImpl,
  mapTimelineEntryStyle,
  mapTimelineEntryStyleInfo,
  timelineStyleForDiffEntry,
  timelineStyleForMergeEntry,
  timelineStyleForVersionEntry,
} from '../timeline-styles';

const BLANK_VALUE = { kind: 'value', value: { kind: 'blank' } } satisfies VersionDiffValue;
const REDACTED_VALUE = {
  kind: 'redacted',
  reason: 'permission-denied',
} satisfies VersionDiffValue;

function value(input: string): VersionDiffValue {
  return { kind: 'value', value: input };
}

function commitId(suffix: string): WorkbookCommitSummary['id'] {
  return `commit:sha256:${suffix}` as WorkbookCommitSummary['id'];
}

function commit(overrides: Partial<WorkbookCommitSummary> = {}): WorkbookCommitSummary {
  return {
    id: commitId('main'),
    parents: [commitId('parent')],
    createdAt: '2026-01-01T00:00:00.000Z',
    author: { redacted: false, actorKind: 'user', displayName: 'Analyst' },
    ...overrides,
  };
}

function structural(
  overrides: Partial<Extract<VersionDiffEntry['structural'], { readonly kind: 'metadata' }>> = {},
): Extract<VersionDiffEntry['structural'], { readonly kind: 'metadata' }> {
  return {
    kind: 'metadata',
    changeId: 'change-1',
    domain: 'cell',
    entityId: 'sheet-1!A1',
    propertyPath: ['value'],
    ...overrides,
  };
}

function diffEntry(overrides: Partial<VersionDiffEntry> = {}): VersionDiffEntry {
  return {
    structural: structural(),
    before: value('before'),
    after: value('after'),
    ...overrides,
  };
}

function reviewDiffChange(
  kind: WorkbookVersionReviewDiffChange['kind'],
): WorkbookVersionReviewDiffChange {
  return {
    target: {
      kind: 'semanticChange',
      changeSetDigest: { algorithm: 'sha256', digest: 'change-set' },
      changeId: 'change-1',
      entityKind: 'cell',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
      derived: false,
    },
    owner: 'cell',
    entity: {
      kind: 'cell',
      workbookId: 'workbook-1',
      sheetId: 'sheet-1',
      id: 'sheet-1!A1',
      displayRef: 'A1',
    },
    propertyPath: ['value'],
    kind,
    before: BLANK_VALUE,
    after: value('after'),
    derived: false,
    diagnostics: [],
  };
}

function mergeChange(overrides: Partial<VersionMergeChange> = {}): VersionMergeChange {
  return {
    structural: structural(),
    base: BLANK_VALUE,
    merged: value('merged'),
    ...overrides,
  };
}

function mergeConflict(overrides: Partial<VersionMergeConflict> = {}): VersionMergeConflict {
  return {
    conflictId: 'conflict-1',
    conflictDigest: 'sha256:conflict',
    conflictKind: 'same-property',
    structural: structural(),
    base: BLANK_VALUE,
    ours: value('ours'),
    theirs: value('theirs'),
    resolutionOptions: [
      {
        optionId: 'option-ours',
        conflictId: 'conflict-1',
        kind: 'acceptOurs',
        value: value('ours'),
        recalcRequired: false,
      },
      {
        optionId: 'option-theirs',
        conflictId: 'conflict-1',
        kind: 'acceptTheirs',
        value: value('theirs'),
        recalcRequired: false,
      },
      {
        optionId: 'option-base',
        conflictId: 'conflict-1',
        kind: 'acceptBase',
        value: BLANK_VALUE,
        recalcRequired: false,
      },
    ],
    ...overrides,
  };
}

describe('timeline style mapper', () => {
  it('maps version commit entries by stable commit role', () => {
    expect(timelineStyleForVersionEntry(commit({ parents: [] }))).toBe('light1');
    expect(timelineStyleForVersionEntry(commit({ parents: [commitId('p1')] }))).toBe('light2');
    expect(
      timelineStyleForVersionEntry(commit({ parents: [commitId('p1'), commitId('p2')] })),
    ).toBe('dark1');
    expect(timelineStyleForVersionEntry(commit({ orphan: true }))).toBe('dark6');
    expect(timelineStyleForVersionEntry(commit({ diagnostics: [{} as never] }))).toBe('dark5');
  });

  it('maps diff entries by semantic change kind', () => {
    expect(timelineStyleForDiffEntry(diffEntry({ before: BLANK_VALUE, after: value('new') }))).toBe(
      'light3',
    );
    expect(timelineStyleForDiffEntry(diffEntry())).toBe('light4');
    expect(timelineStyleForDiffEntry(diffEntry({ before: value('old'), after: BLANK_VALUE }))).toBe(
      'light6',
    );
    expect(
      timelineStyleForDiffEntry(diffEntry({ structural: structural({ propertyPath: ['order'] }) })),
    ).toBe('light5');
    expect(timelineStyleForDiffEntry(diffEntry({ after: REDACTED_VALUE }))).toBe('dark5');
    expect(timelineStyleForDiffEntry(diffEntry({ diagnostics: [{} as never] }))).toBe('dark5');
  });

  it('maps review diff entries through their existing review change kind', () => {
    expect(timelineStyleForDiffEntry(reviewDiffChange('create'))).toBe('light3');
    expect(timelineStyleForDiffEntry(reviewDiffChange('update'))).toBe('light4');
    expect(timelineStyleForDiffEntry(reviewDiffChange('move'))).toBe('light5');
    expect(timelineStyleForDiffEntry(reviewDiffChange('reorder'))).toBe('light5');
    expect(timelineStyleForDiffEntry(reviewDiffChange('delete'))).toBe('light6');
  });

  it('maps merge entries by clean, three-way, diagnostic, and conflict states', () => {
    expect(timelineStyleForMergeEntry(mergeChange())).toBe('dark3');
    expect(
      timelineStyleForMergeEntry(mergeChange({ ours: value('ours'), theirs: value('theirs') })),
    ).toBe('dark2');
    expect(timelineStyleForMergeEntry(mergeChange({ diagnostics: [{} as never] }))).toBe('dark5');
    expect(timelineStyleForMergeEntry(mergeConflict())).toBe('dark6');
  });

  it('dispatches version, diff, and merge entries through one deterministic mapper', () => {
    const version = { kind: 'version', entry: commit({ parents: [] }) } as const;
    const diff = {
      kind: 'diff',
      entry: diffEntry({ before: BLANK_VALUE, after: value('new') }),
    } as const;
    const merge = { kind: 'merge', entry: mergeConflict() } as const;

    expect(mapTimelineEntryStyle(version)).toBe('light1');
    expect(mapTimelineEntryStyle(diff)).toBe('light3');
    expect(mapTimelineEntryStyle(merge)).toBe('dark6');
    expect(mapTimelineEntryStyle(version)).toBe(mapTimelineEntryStyle(version));
    expect(mapTimelineEntryStyleInfo(version)).toEqual({
      name: DEFAULT_TIMELINE_STYLE,
      isDefault: true,
    });
  });
});

describe('WorkbookTimelineStylesImpl', () => {
  it('delegates setDefault to the compute bridge instead of no-oping', async () => {
    const setDefaultSlicerStyle = jest.fn(async () => undefined);
    const api = new WorkbookTimelineStylesImpl({
      ctx: {
        computeBridge: {
          setDefaultSlicerStyle,
        },
      } as never,
    });

    await api.setDefault('dark2');
    await api.setDefault(null);

    expect(setDefaultSlicerStyle).toHaveBeenNthCalledWith(1, 'dark2');
    expect(setDefaultSlicerStyle).toHaveBeenNthCalledWith(2, null);
  });
});
