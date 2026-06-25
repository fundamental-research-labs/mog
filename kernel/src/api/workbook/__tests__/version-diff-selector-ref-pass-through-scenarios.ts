import { expect, it, jest } from '@jest/globals';

import { createVersion, ROOT_COMMIT_ID } from './version-diff-selector-test-utils';
import {
  emptySemanticDiffPage,
  emptySemanticDiffSuccess,
} from './version-diff-selector-ref-helpers';

export function registerSelectorRefPassThroughScenarios(): void {
  it('passes public branch refs through to the attached diff service', async () => {
    const diff = jest.fn(async () => emptySemanticDiffSuccess());
    const version = createVersion(diff);

    const result = await version.diff(
      ROOT_COMMIT_ID,
      { kind: 'ref', name: 'refs/heads/scenario/branch' },
      { pageSize: 25 },
    );

    expect(result).toEqual({
      ok: true,
      value: emptySemanticDiffPage(25),
    });
    expect(diff).toHaveBeenCalledWith(
      { kind: 'commit', id: ROOT_COMMIT_ID },
      { kind: 'ref', name: 'refs/heads/scenario/branch' },
      { pageSize: 25 },
    );
  });
}
