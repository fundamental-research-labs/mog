import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import type { VersionMergeInput, VersionMergeResult } from '@mog-sdk/contracts/api';

const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];

describe('WorkbookVersion merge facade', () => {
  it('delegates merge preview through an attached document-scoped service', async () => {
    const result: VersionMergeResult = {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
    const merge = jest.fn(async () => result);
    const version = new WorkbookVersionImpl({
      versioning: { mergeService: { merge } },
    } as any);

    await expect(
      version.merge({ base: BASE, ours: OURS, theirs: THEIRS }, { mode: 'preview' }),
    ).resolves.toStrictEqual(result);
    expect(merge).toHaveBeenCalledWith(
      { base: BASE, ours: OURS, theirs: THEIRS },
      { mode: 'preview' },
    );
  });

  it('returns a blocked preview result when merge input is malformed', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: { mergeService: { merge } },
    } as any);

    await expect(
      version.merge({ base: 'not-a-commit', ours: OURS, theirs: THEIRS } as any),
    ).resolves.toMatchObject({
      status: 'blocked',
      base: null,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_INVALID_OPTIONS' })],
      mutationGuarantee: 'preview-only',
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('reports merge as pending when no merge service is attached', async () => {
    const version = new WorkbookVersionImpl({ versioning: {} } as any);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toMatchObject({
      status: 'blocked',
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_MERGE_SERVICE_UNAVAILABLE' })],
      mutationGuarantee: 'preview-only',
    });
    await expect(version.getStatus()).resolves.toMatchObject({
      merge: {
        stage: 'pending',
        available: false,
      },
    });
  });
});
