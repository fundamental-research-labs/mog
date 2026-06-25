import { expect, it, jest } from '@jest/globals';

import type { VersionSemanticDiffPage } from '@mog-sdk/contracts/api';

import { createVersion, READ_REVISION, ROOT_COMMIT_ID } from './version-diff-selector-test-utils';

export function registerSelectorRedactionDiffEntryScenarios(): void {
  it('preserves redacted diff entries without exposing hidden domain metadata', async () => {
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [
        {
          structural: { kind: 'redacted', reason: 'redaction-policy' },
          before: { kind: 'redacted', reason: 'historical-acl-unavailable' },
          after: { kind: 'redacted', reason: 'redaction-policy' },
          display: {
            entityLabel: { kind: 'redacted', reason: 'permission-denied' },
          },
        },
      ],
      readRevision: READ_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    }));
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

    expect(result).toEqual({
      ok: true,
      value: {
        items: [
          {
            structural: { kind: 'redacted', reason: 'redaction-policy' },
            before: { kind: 'redacted', reason: 'historical-acl-unavailable' },
            after: { kind: 'redacted', reason: 'redaction-policy' },
            display: {
              entityLabel: { kind: 'redacted', reason: 'permission-denied' },
            },
          },
        ],
        limit: 50,
        readRevision: READ_REVISION,
        order: 'semantic-change-order',
      } satisfies VersionSemanticDiffPage,
    });
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(JSON.stringify(result)).not.toContain('domain');
  });
}
