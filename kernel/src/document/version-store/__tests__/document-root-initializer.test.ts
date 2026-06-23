import { jest } from '@jest/globals';

import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';

import { BLANK_WORKBOOK_ROOT_GRAPH_ID } from '../blank-workbook-root';
import { withDocumentRootInitializer } from '../document-root-initializer';
import { namespaceForDocumentScope } from '../provider';
import { XLSX_IMPORT_ROOT_GRAPH_ID } from '../xlsx-import-root';
import type { VersionSemanticStateReaderPort } from '../semantic-state-reader';
import type { SemanticWorkbookStateEnvelope } from '../../../bridges/compute/compute-types.gen';

const DOCUMENT_ID = 'document-root-initializer-doc';
const CREATED_AT = '2026-06-22T00:00:00.000Z';
const STATE_DIGEST = {
  algorithm: 'sha256' as const,
  digest: 'b'.repeat(64),
};
const SEMANTIC_STATE = {
  state: {
    schemaVersion: 'semantic-workbook-state.v1',
    domains: {},
    sheets: {
      'sheet-1': {
        name: 'Sheet1',
        index: 0,
      },
    },
  },
  stateDigest: STATE_DIGEST,
} as unknown as SemanticWorkbookStateEnvelope;

describe('document root initializer', () => {
  it('attaches a lazy blank workbook root initializer for fresh provider-selected workbooks', async () => {
    const encodeDiff = jest.fn().mockResolvedValue(new Uint8Array([0x05]) as never);
    const semanticStateReader: VersionSemanticStateReaderPort = {
      readCurrentSemanticState: jest.fn().mockResolvedValue(SEMANTIC_STATE as never),
      diffSemanticStates: jest.fn(),
    };

    const versioning = await withDocumentRootInitializer({
      documentId: DOCUMENT_ID,
      versioning: {
        providerSelection: { kind: 'memory' },
        snapshotRootByteSyncPort: { encodeDiff },
        semanticStateReader,
      },
      blankWorkbookRootInitializerEnabled: true,
      createdAt: CREATED_AT,
    });

    expect(encodeDiff).not.toHaveBeenCalled();
    expect(semanticStateReader.readCurrentSemanticState).not.toHaveBeenCalled();

    const initialize = versioning.providerSelection?.initialize;
    expect(initialize).toMatchObject({
      graphId: BLANK_WORKBOOK_ROOT_GRAPH_ID,
      historyRootKind: 'new',
      historyRootPolicy: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.defaultHistoryRootPolicy,
    });
    if (!initialize || !('buildRootWrite' in initialize)) {
      throw new Error('expected lazy root initializer');
    }

    const rootWrite = await initialize.buildRootWrite();
    expect(encodeDiff).toHaveBeenCalledTimes(1);
    expect(semanticStateReader.readCurrentSemanticState).toHaveBeenCalledTimes(1);
    expect(rootWrite.snapshotRootRecord.namespace).toEqual(
      namespaceForDocumentScope({ documentId: DOCUMENT_ID }, BLANK_WORKBOOK_ROOT_GRAPH_ID),
    );
    expect(rootWrite.semanticChangeSetRecord.preimage.payload).toMatchObject({
      source: {
        kind: 'blankWorkbookRoot',
        semanticStateDigest: STATE_DIGEST,
      },
      changes: [],
    });
  });

  it('does not override an explicit provider root initializer', async () => {
    const rootWrite = {
      snapshotRootRecord: {} as never,
      semanticChangeSetRecord: {} as never,
      author: { authorId: 'host', actorKind: 'system' as const, displayName: 'Host' },
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    };

    const versioning = await withDocumentRootInitializer({
      documentId: DOCUMENT_ID,
      versioning: {
        providerSelection: {
          kind: 'memory',
          initialize: { graphId: 'host-root', rootWrite },
        },
        snapshotRootByteSyncPort: { encodeDiff: jest.fn() },
        semanticStateReader: {
          readCurrentSemanticState: jest.fn(),
          diffSemanticStates: jest.fn(),
        },
      },
      blankWorkbookRootInitializerEnabled: true,
      createdAt: CREATED_AT,
    });

    expect(versioning.providerSelection?.initialize).toBeDefined();
    expect(versioning.providerSelection?.initialize?.graphId).toBe('host-root');
    if (!versioning.providerSelection?.initialize) throw new Error('expected initializer');
    expect('rootWrite' in versioning.providerSelection.initialize).toBe(true);
  });

  it('attaches public root policy metadata for XLSX import roots and reimports', async () => {
    const encodeDiff = jest.fn().mockResolvedValue(new Uint8Array([0x06]) as never);
    const semanticStateReader: VersionSemanticStateReaderPort = {
      readCurrentSemanticState: jest.fn().mockResolvedValue(SEMANTIC_STATE as never),
      diffSemanticStates: jest.fn(),
    };

    const versioning = await withDocumentRootInitializer({
      documentId: DOCUMENT_ID,
      versioning: {
        providerSelection: { kind: 'memory' },
        snapshotRootByteSyncPort: { encodeDiff },
        semanticStateReader,
      },
      xlsxImportRoot: {
        kind: 'xlsx',
        source: { sourceType: 'bytes', byteLength: 10 },
        diagnostics: [],
        versionMetadataTrust: {
          status: 'absent',
          sidecarPart: 'customXml/mog-version-metadata.xml',
        },
      },
      blankWorkbookRootInitializerEnabled: false,
      createdAt: CREATED_AT,
    });

    expect(versioning.providerSelection?.initialize).toMatchObject({
      graphId: XLSX_IMPORT_ROOT_GRAPH_ID,
      historyRootKind: 'import',
      historyRootPolicy: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.defaultHistoryRootPolicy,
    });
    expect(versioning.xlsxImportRootExistingGraph).toMatchObject({
      historyRootPolicy: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.defaultHistoryRootPolicy,
    });
  });
});
