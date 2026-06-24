import type { ObjectDigest, VersionHead, WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../context';
import { createMogWorkbookVersionXlsxMetadata } from '../version/xlsx-metadata/xlsx-version-metadata';
import { authorizeMetadataSinkWrite } from '../version/xlsx-metadata/version-xlsx-metadata-export-gate';

const PROVIDER_DOCUMENT_ID = 'vc10-xlsx-metadata-provider-scope';
const PROVIDER_WORKSPACE_ID = 'vc10-xlsx-metadata-provider-workspace';
const LINK_DOCUMENT_ID = 'vc10-xlsx-metadata-link-scope';
const LINK_WORKSPACE_ID = 'vc10-xlsx-metadata-link-workspace';
const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const REF_REVISION = { kind: 'counter', value: '1' } as const;
const SEMANTIC_CHANGE_SET_DIGEST = objectDigest('1');
const SNAPSHOT_ROOT_DIGEST = objectDigest('2');

describe('XLSX version metadata document scope', () => {
  it('uses provider document scope for trusted metadata export when workbookLinkScope is known', () => {
    const head: VersionHead = {
      id: COMMIT_ID,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: REF_REVISION,
    };

    const metadata = createMogWorkbookVersionXlsxMetadata(
      metadataContext(),
      { ok: true, value: head },
      {
        semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
        snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
      },
    );

    const authorization = authorizeMetadataSinkWrite(metadata, {
      currentHead: {
        commitId: head.id,
        refName: head.refName,
        resolvedFrom: head.resolvedFrom,
        refRevision: head.refRevision,
      },
      semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
      snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
    });

    expect(authorization).toMatchObject({
      ok: true,
      value: {
        metadata: {
          documentId: PROVIDER_DOCUMENT_ID,
          workspaceId: PROVIDER_WORKSPACE_ID,
        },
      },
    });
    expect(metadata.documentId).not.toBe(LINK_DOCUMENT_ID);
    expect(metadata.workspaceId).not.toBe(LINK_WORKSPACE_ID);
  });
});

function metadataContext(): DocumentContext {
  return {
    clock: { dateNow: () => Date.parse('2026-06-23T00:00:00.000Z') },
    workbookLinkScope: () => ({
      requestingDocumentId: LINK_DOCUMENT_ID,
      requestingWorkspaceId: LINK_WORKSPACE_ID,
    }),
    versioning: {
      provider: {
        documentScope: {
          documentId: PROVIDER_DOCUMENT_ID,
          workspaceId: PROVIDER_WORKSPACE_ID,
        },
        accessContext: {},
        readGraphRegistry: async () => {
          throw new Error('metadata scope regression does not read the registry');
        },
        openGraph: async () => {
          throw new Error('metadata scope regression does not open the graph');
        },
      },
    },
  } as DocumentContext;
}

function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}
