import { expect, it, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';

export function registerDomainSupportGateRequiredSourceScenarios(): void {
  it('fails closed when an advertised required manifest source is missing', async () => {
    const readDomainSupportManifest = jest.fn(async () => null);
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        readDomainSupportManifest,
        requireDomainSupportManifest: true,
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.commit',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    expect(readDomainSupportManifest).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
}
