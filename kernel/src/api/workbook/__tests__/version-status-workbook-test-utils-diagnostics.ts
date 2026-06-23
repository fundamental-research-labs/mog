import { expect } from '@jest/globals';

import type { VersionGraphInitializeResult } from '../../../document/version-store/provider';

export function versionUnavailable(
  operation: 'getHead' | 'listCommits' | 'diff',
  code: string,
  data: Record<string, unknown> = {},
) {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        expect.objectContaining({
          code,
          data: expect.objectContaining({ redacted: true, ...data }),
        }),
      ],
    },
  };
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}
