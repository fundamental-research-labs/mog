import { it } from '@jest/globals';

import { expectUntrustedNewRootReimport } from './version-xlsx-reimport-trust-assertions';
import {
  createCopiedSidecarFromAnotherDocumentScenario,
  createForgedLexicalCommitMetadataXlsx,
  createRemoteAuthorityUnavailableMetadataXlsx,
  seedOriginalTrustedExport,
  UNTRUSTED_METADATA_CASES,
} from './version-xlsx-reimport-trust-untrusted-metadata-cases';

export function registerUntrustedMetadataReimportScenarios(): void {
  it('fails closed for a real copied sidecar from another document', async () => {
    await expectUntrustedNewRootReimport(await createCopiedSidecarFromAnotherDocumentScenario());
  });

  it.each(UNTRUSTED_METADATA_CASES)('fails closed for $name metadata', async ({ reason, xlsx }) => {
    const seed = await seedOriginalTrustedExport();

    await expectUntrustedNewRootReimport({
      xlsxBytes: await xlsx(seed),
      expectedHeadCommitId: seed.rootCommitId,
      reason,
    });
  });

  it('fails closed for a forged lexical commit id that is absent from the selected graph', async () => {
    const seed = await seedOriginalTrustedExport();

    await expectUntrustedNewRootReimport({
      xlsxBytes: await createForgedLexicalCommitMetadataXlsx(seed),
      expectedHeadCommitId: seed.rootCommitId,
      reason: 'commit-missing',
    });
  });

  it('fails closed when trusted remote metadata authority is unavailable', async () => {
    const seed = await seedOriginalTrustedExport();

    await expectUntrustedNewRootReimport({
      xlsxBytes: await createRemoteAuthorityUnavailableMetadataXlsx(seed),
      expectedHeadCommitId: seed.rootCommitId,
      reason: 'head-unverified',
    });
  });
}
