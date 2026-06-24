import type { VersionHead, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { maybeAddMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import {
  blockedMetadataSink,
  createSourceXlsx,
  expectAuthorityExportBlocked,
  expectMogMetadataExportBlocked,
  metadataExportAuthorityProvider,
  metadataExportContext,
  METADATA_EXPORT_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  REF_REVISION,
  versionHead,
} from './version-xlsx-metadata-export-gate-test-helpers';

export function registerAuthorityProofScenarios(): void {
  it('blocks Mog version metadata sidecar export when stale-head revision proof is missing', async () => {
    const unprovenHead = versionHead({ id: OLD_METADATA_COMMIT_ID });

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: unprovenHead,
          }),
        }),
        { getHead: async () => ({ ok: true, value: unprovenHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'head-unverified',
    );
  });

  it('blocks Mog version metadata sidecar export when ref revision proof is malformed', async () => {
    const malformedRevisionHead = {
      ...versionHead({ id: OLD_METADATA_COMMIT_ID }),
      refRevision: { kind: 'counter', value: '01' },
    } satisfies VersionHead;

    await expectAuthorityExportBlocked(
      { provider: { documentId: METADATA_EXPORT_DOCUMENT_ID, head: malformedRevisionHead } },
      'head-unverified',
    );
  });

  it('blocks Mog version metadata sidecar export when commit identity is only lexical', async () => {
    const lexicalHead = {
      id: 'commit:sha256:not-a-real-commit-object' as WorkbookCommitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: REF_REVISION,
    } satisfies VersionHead;

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: versionHead({
              id: OLD_METADATA_COMMIT_ID,
              refRevision: REF_REVISION,
            }),
          }),
        }),
        { getHead: async () => ({ ok: true, value: lexicalHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'head-unverified',
    );
  });
}
