import { jest } from '@jest/globals';

import type { SemanticWorkbookStateEnvelope } from '../../../bridges/compute/compute-types.gen';
import type { VersionGraphNamespace } from '../object-store';
import type { VersionSemanticStateReaderPort } from '../semantic-state-reader';
import {
  WORKBOOK_SNAPSHOT_ROOT_OBJECT_TYPE,
  YRS_FULL_STATE_SNAPSHOT_ROOT_ENCODING,
  YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
  YRS_FULL_STATE_SNAPSHOT_ROOT_SCHEMA_VERSION,
  YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
} from '../snapshot-root-capture';
import { buildXlsxVersionImportRootWrite } from '../xlsx-import-root';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'xlsx-import-root',
  principalScope: 'principal-1',
};

const CREATED_AT = '2026-06-24T00:00:00.000Z';
const STATE_DIGEST = {
  algorithm: 'sha256' as const,
  digest: 'c'.repeat(64),
};
const TRUSTED_METADATA_DOCUMENT_ID = 'trusted-metadata-document';
const TRUSTED_METADATA_COMMIT_ID = `commit:sha256:${'d'.repeat(64)}`;
const TRUSTED_METADATA_SIDECAR_PART = 'customXml/mog-version-metadata.xml';
const SEMANTIC_STATE = {
  state: {
    schemaVersion: 'semantic-workbook-state.v1',
    domains: {},
    sheets: {},
  },
  stateDigest: STATE_DIGEST,
} as unknown as SemanticWorkbookStateEnvelope;

describe('xlsx import root', () => {
  it('builds snapshot root records without decoding freshly captured base64', async () => {
    const globalWithAtob = globalThis as typeof globalThis & { atob?: typeof atob };
    const hadAtob = Object.prototype.hasOwnProperty.call(globalWithAtob, 'atob');
    const originalAtob = globalWithAtob.atob;
    const atobSpy = jest.fn(() => {
      throw new Error('XLSX import root should not decode freshly captured snapshot bytes.');
    });
    Object.defineProperty(globalWithAtob, 'atob', {
      configurable: true,
      writable: true,
      value: atobSpy,
    });
    const encodeDiff = jest.fn().mockResolvedValue(new Uint8Array([0, 1, 2, 3]) as never);
    const semanticStateReader: VersionSemanticStateReaderPort = {
      readCurrentSemanticState: jest.fn().mockResolvedValue(SEMANTIC_STATE as never),
      diffSemanticStates: jest.fn(),
    };

    try {
      const rootWrite = await buildXlsxVersionImportRootWrite({
        namespace: NAMESPACE,
        snapshotRootByteSyncPort: { encodeDiff },
        semanticStateReader,
        provenance: {
          kind: 'xlsx',
          source: { sourceType: 'bytes', byteLength: 4 },
          diagnostics: [],
        },
        createdAt: CREATED_AT,
      });

      expect(atobSpy).not.toHaveBeenCalled();
      expect(rootWrite.snapshotRootRecord.preimage.objectType).toBe(
        WORKBOOK_SNAPSHOT_ROOT_OBJECT_TYPE,
      );
      expect(rootWrite.snapshotRootRecord.preimage.payload).toEqual({
        schemaVersion: YRS_FULL_STATE_SNAPSHOT_ROOT_SCHEMA_VERSION,
        kind: YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
        encoding: YRS_FULL_STATE_SNAPSHOT_ROOT_ENCODING,
        bytes: 'AAECAw==',
        byteLength: 4,
        source: YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
      });
      expect(rootWrite.semanticChangeSetRecord.preimage.payload).toMatchObject({
        source: {
          kind: 'xlsxImportRoot',
          semanticStateDigest: STATE_DIGEST,
        },
      });
    } finally {
      if (hadAtob) {
        Object.defineProperty(globalWithAtob, 'atob', {
          configurable: true,
          writable: true,
          value: originalAtob,
        });
      } else {
        Reflect.deleteProperty(globalWithAtob, 'atob');
      }
    }
  });

  it('persists trusted XLSX metadata only as a redacted import-root trust summary', async () => {
    const encodeDiff = jest.fn().mockResolvedValue(new Uint8Array([4, 5, 6]) as never);
    const semanticStateReader: VersionSemanticStateReaderPort = {
      readCurrentSemanticState: jest.fn().mockResolvedValue(SEMANTIC_STATE as never),
      diffSemanticStates: jest.fn(),
    };

    const rootWrite = await buildXlsxVersionImportRootWrite({
      namespace: NAMESPACE,
      snapshotRootByteSyncPort: { encodeDiff },
      semanticStateReader,
      provenance: {
        kind: 'xlsx',
        source: { sourceType: 'bytes', byteLength: 3 },
        diagnostics: [],
        versionMetadataTrust: {
          status: 'trusted',
          sidecarPart: TRUSTED_METADATA_SIDECAR_PART,
          redacted: true,
        },
        versionMetadataHeadCandidate: {
          documentId: TRUSTED_METADATA_DOCUMENT_ID,
          head: {
            commitId: TRUSTED_METADATA_COMMIT_ID,
            refName: 'refs/heads/main',
            resolvedFrom: 'HEAD',
            refRevision: { kind: 'counter', value: '7' },
            semanticChangeSetDigest: { algorithm: 'sha256', digest: 'e'.repeat(64) },
            snapshotRootDigest: { algorithm: 'sha256', digest: 'f'.repeat(64) },
          },
        },
      },
      createdAt: CREATED_AT,
    });

    const semanticPayload = rootWrite.semanticChangeSetRecord.preimage.payload;
    expect(semanticPayload).toMatchObject({
      source: {
        kind: 'xlsxImportRoot',
        versionMetadataTrust: {
          status: 'trusted',
          sidecarPart: TRUSTED_METADATA_SIDECAR_PART,
          redacted: true,
        },
        semanticStateDigest: STATE_DIGEST,
      },
      importDiagnostics: [],
    });
    expect(JSON.stringify(semanticPayload)).not.toContain(TRUSTED_METADATA_DOCUMENT_ID);
    expect(JSON.stringify(semanticPayload)).not.toContain(TRUSTED_METADATA_COMMIT_ID);
    expect(JSON.stringify(semanticPayload)).not.toContain('versionMetadataHeadCandidate');
  });
});
