import { expect, jest } from '@jest/globals';

import type { VersionStoreProvider } from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';

export function publicWorkbookVersion(provider: VersionStoreProvider, merge: unknown) {
  return new WorkbookVersionImpl({
    versioning: {
      provider,
      mergeService: { merge },
      ...versionDomainSupportManifestRuntime(),
    },
  } as any);
}

export function mergeServiceMustNotRun() {
  return jest.fn(async () => {
    throw new Error('merge service should not be invoked after merge-base resolution fails');
  });
}

export function expectPublicSafeMergeFailure(
  result: Awaited<ReturnType<WorkbookVersionImpl['merge']>>,
  code: string,
  payload: Readonly<Record<string, string | number | boolean | null>> = {},
) {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.merge',
      diagnostics: [
        expect.objectContaining({
          code,
          owner: 'version-store',
          data: expect.objectContaining({
            operation: 'merge',
            redacted: true,
            payload: expect.objectContaining({
              operation: 'merge',
              ...payload,
            }),
          }),
        }),
      ],
    },
  });
  if (result.ok) {
    throw new Error('expected public merge failure');
  }

  const diagnostic = result.error.diagnostics.find((item) => item.code === code);
  expect(diagnostic).toBeDefined();
  expect(JSON.stringify(diagnostic)).not.toContain('commit:sha256:');
  return diagnostic!;
}
