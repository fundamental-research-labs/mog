import 'fake-indexeddb/auto';

import type { VersionHead } from '@mog-sdk/contracts/api';

import {
  maybeAddMogVersionMetadataToXlsx,
  MOG_VERSION_METADATA_PART,
} from '../version/xlsx-metadata/xlsx-version-metadata';
import {
  authorizeMetadataSinkWrite,
  REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS,
  type MogVersionMetadataExportSinkAuthorization,
} from '../version/xlsx-metadata/version-xlsx-metadata-export-gate';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import {
  createSourceXlsx,
  metadataExportAuthorityProvider,
  metadataExportContext,
  METADATA_EXPORT_DOCUMENT_ID,
  objectDigest,
  OLD_METADATA_COMMIT_ID,
  recordingMetadataSink,
  REF_REVISION,
  SEMANTIC_CHANGE_SET_DIGEST,
  SNAPSHOT_ROOT_DIGEST,
  versionHead,
} from './version-xlsx-metadata-export-gate-test-helpers';

beforeEach(deleteVersionStoreIndexedDbForTesting);
afterEach(deleteVersionStoreIndexedDbForTesting);

describe('VC-10 XLSX metadata export gating - sink authorization', () => {
  it('authorizes the metadata sink only after redaction and object-store authority preflight', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });
    const captured: { writes: number; authorization?: MogVersionMetadataExportSinkAuthorization } =
      { writes: 0 };
    const sinkResult = new Uint8Array([1, 2, 3]);

    const exported = await maybeAddMogVersionMetadataToXlsx(
      metadataExportContext({
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        provider: metadataExportAuthorityProvider({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          head: currentHead,
        }),
      }),
      { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
        typeof maybeAddMogVersionMetadataToXlsx
      >[1],
      await createSourceXlsx(),
      { versionMetadata: 'include' },
      recordingMetadataSink(captured, sinkResult),
    );

    expect(exported).toBe(sinkResult);
    expect(captured.writes).toBe(1);
    expect(captured.authorization).toMatchObject({
      sidecarPart: MOG_VERSION_METADATA_PART,
      currentHead: {
        commitId: OLD_METADATA_COMMIT_ID,
        refName: 'refs/heads/main',
        resolvedFrom: 'HEAD',
        refRevision: REF_REVISION,
      },
      objectStoreAuthority: {
        semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
        snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
      },
      redaction: {
        diagnostics: 'none',
        redacted: true,
      },
      metadata: {
        diagnostics: [],
        redaction: {
          policy: 'commit-document-and-object-digests-only',
          omitted: expect.arrayContaining(REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS),
        },
        head: {
          commitId: OLD_METADATA_COMMIT_ID,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      },
    });
    const authorization = captured.authorization;
    if (!authorization) throw new Error('expected metadata sink authorization');
    const sinkAuthority = {
      currentHead: authorization.currentHead,
      semanticChangeSetDigest: authorization.objectStoreAuthority.semanticChangeSetDigest,
      snapshotRootDigest: authorization.objectStoreAuthority.snapshotRootDigest,
    };
    const metadata = authorization.metadata;
    for (const [unsafeMetadata, reason] of [
      [{ ...metadata, diagnostics: [{ message: 'secret' }] }, 'redaction-failed'],
      [
        { ...metadata, redaction: { ...metadata.redaction, omitted: ['authors'] } },
        'redaction-failed',
      ],
      [
        {
          ...metadata,
          head: { ...metadata.head!, commitId: 'commit:sha256:not-real' as VersionHead['id'] },
        },
        'head-unverified',
      ],
      [
        { ...metadata, head: { ...metadata.head!, refRevision: { kind: 'counter', value: '01' } } },
        'head-unverified',
      ],
      [
        { ...metadata, head: { ...metadata.head!, snapshotRootDigest: objectDigest('3') } },
        'head-unverified',
      ],
    ] as const) {
      expect(authorizeMetadataSinkWrite(unsafeMetadata, sinkAuthority)).toEqual({
        ok: false,
        reason,
      });
    }
  });
});
