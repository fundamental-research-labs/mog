import { expect, it, jest } from '@jest/globals';

import { createVersion } from './version-diff-selector-test-utils';
import { emptySemanticDiffSuccess } from './version-diff-selector-ref-helpers';

export function registerSelectorRefAllowedScenarios(): void {
  it('preserves HEAD and main ref selector behavior', async () => {
    const diff = jest.fn(async () => emptySemanticDiffSuccess());
    const version = createVersion(diff);

    await expect(
      version.diff({ kind: 'ref', name: 'HEAD' }, { kind: 'ref', name: 'refs/heads/main' }),
    ).resolves.toMatchObject({ ok: true });

    expect(diff).toHaveBeenCalledWith(
      { kind: 'ref', name: 'HEAD' },
      { kind: 'ref', name: 'refs/heads/main' },
      {},
    );
  });
}
