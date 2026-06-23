import type { Workbook, WorkbookCommitId } from '@mog-sdk/contracts/api';
import type {
  MogWorkbookVersionXlsxMetadata,
  MogWorkbookVersionXlsxMetadataExpectedHead,
} from '../xlsx-version-metadata';

import { DocumentFactory } from '../../document/document-factory';
import { createWorkbook } from '../create-workbook';
import {
  addMogVersionMetadataToXlsx,
  readAndValidateMogVersionMetadataFromXlsx,
} from '../xlsx-version-metadata';
import { createVersionObjectRecord } from '../../../document/version-store/object-store';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb-backend';
import { captureWorkbookSnapshotRootRecord } from '../../../document/version-store/snapshot-root-capture';
import { DOCUMENT_ID, WORKSPACE_ID } from './version-xlsx-reimport-trust-constants';
import {
  openIndexedDbGraph,
  readLocalExpectedHead,
} from './version-xlsx-reimport-trust-version-store';
import { withVersionManifest } from './version-domain-support-test-utils';

export type TrustedExportSeed = {
  readonly rootCommitId: WorkbookCommitId;
  readonly exported: Uint8Array;
  readonly metadata: MogWorkbookVersionXlsxMetadata;
};

export async function seedTrustedExport(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly a1Value: string;
}): Promise<TrustedExportSeed> {
  const imported = await importXlsxWithVersioning({
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    xlsxBytes: await createSourceXlsx(input.a1Value),
  });
  expect(imported.success).toBe(true);
  if (!imported.success || !imported.handle) {
    throw new Error(`expected seed import success: ${imported.error?.message}`);
  }

  let wb: Workbook | undefined;
  try {
    wb = await imported.handle.workbook({ versioning: versioning(input.workspaceId) });
    const head = await expectVersionHead(wb);
    const expectedHead = await readLocalExpectedHead(input.documentId, input.workspaceId);
    const metadata = trustedVersionMetadata(input.documentId, input.workspaceId, expectedHead);
    const exported = addMogVersionMetadataToXlsx(await createSourceXlsx(input.a1Value), metadata);
    const validatedMetadata = readAndValidateMogVersionMetadataFromXlsx(exported, {
      expectedDocumentId: input.documentId,
      ...(input.workspaceId ? { expectedWorkspaceId: input.workspaceId } : {}),
      expectedHead,
    });
    expect(validatedMetadata).toMatchObject({ status: 'trusted' });
    if (validatedMetadata.status !== 'trusted') {
      throw new Error(`expected trusted seed metadata: ${validatedMetadata.status}`);
    }
    return {
      rootCommitId: head.id,
      exported,
      metadata: validatedMetadata.metadata,
    };
  } finally {
    await wb?.close('skipSave').catch(() => {});
    await imported.handle.dispose().catch(() => {});
  }
}

export async function advanceLocalHead(seed: TrustedExportSeed): Promise<WorkbookCommitId> {
  const { provider, graph, namespace } = await openIndexedDbGraph(DOCUMENT_ID, WORKSPACE_ID);
  try {
    const head = await graph.readHead();
    expect(head.status).toBe('success');
    if (head.status !== 'success') throw new Error(`expected local graph head`);
    expect(head.head.id).toBe(seed.rootCommitId);

    const semanticState = localAdvanceSemanticState();
    const snapshotRootRecord = await captureWorkbookSnapshotRootRecord(namespace, {
      encodeDiff: async () => new Uint8Array([0x51, 0x52, 0x53]),
    });
    const semanticChangeSetRecord = await createVersionObjectRecord(namespace, {
      objectType: 'workbook.semanticChangeSet.v1',
      schemaVersion: 1,
      payloadEncoding: 'mog-canonical-json-v1',
      dependencies: [],
      payload: {
        schemaVersion: 1,
        source: {
          kind: 'testLocalAdvance',
          semanticStateDigest: semanticState.stateDigest,
        },
        semanticState,
        changes: [],
      },
    });

    const committed = await graph.commit({
      snapshotRootRecord,
      semanticChangeSetRecord,
      author: {
        authorId: 'test.local-advance',
        actorKind: 'user',
        displayName: 'Local Advance',
      },
      createdAt: '2026-06-23T00:00:00.000Z',
      completenessDiagnostics: [],
      expectedHeadCommitId: head.head.id,
      expectedMainRefVersion: head.main.revision,
    });
    expect(committed.status).toBe('success');
    if (committed.status !== 'success') {
      throw new Error(`expected local advance commit: ${committed.diagnostics[0]?.code}`);
    }
    return committed.commit.id;
  } finally {
    await provider.close('test-teardown').catch(() => {});
  }
}

export async function importXlsxWithVersioning(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly xlsxBytes: Uint8Array;
}) {
  return DocumentFactory.createFromXlsx({ type: 'bytes', data: input.xlsxBytes }, {
    documentId: input.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
    versioning: versioning(input.workspaceId),
  } as Parameters<typeof DocumentFactory.createFromXlsx>[1] & { versioning: unknown });
}

export function versioning(workspaceId?: string) {
  return withVersionManifest({
    providerSelection: versioningProviderSelection(workspaceId),
  });
}

function versioningProviderSelection(workspaceId?: string) {
  return {
    kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
    requireDurablePersistence: true,
    ...(workspaceId ? { workspaceId } : {}),
  };
}

function trustedVersionMetadata(
  documentId: string,
  workspaceId: string | undefined,
  expectedHead: MogWorkbookVersionXlsxMetadataExpectedHead,
): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-23T00:00:00.000Z',
    documentId,
    ...(workspaceId ? { workspaceId } : {}),
    head: {
      commitId: expectedHead.commitId,
      ...(expectedHead.refName ? { refName: expectedHead.refName } : {}),
      ...(expectedHead.resolvedFrom ? { resolvedFrom: expectedHead.resolvedFrom } : {}),
      ...(expectedHead.refRevision ? { refRevision: expectedHead.refRevision } : {}),
      ...(expectedHead.semanticChangeSetDigest
        ? { semanticChangeSetDigest: expectedHead.semanticChangeSetDigest }
        : {}),
      ...(expectedHead.snapshotRootDigest
        ? { snapshotRootDigest: expectedHead.snapshotRootDigest }
        : {}),
    },
    diagnostics: [],
    redaction: {
      policy: 'commit-document-and-object-digests-only',
      omitted: [
        'authors',
        'agentTraces',
        'rawWorkbookBytes',
        'credentials',
        'externalDataSecrets',
        'objectStoreNamespace',
        'workspaceId',
        'principalScope',
      ],
    },
  };
}

export async function createSourceXlsx(a1Value: string): Promise<Uint8Array> {
  const wb = await createWorkbook({
    documentId: `vc10-xlsx-reimport-source-${a1Value.replace(/\W+/g, '-').toLowerCase()}`,
    userTimezone: 'UTC',
  });
  try {
    await wb.activeSheet.setCell('A1', a1Value);
    await wb.activeSheet.setCell('B1', 42);
    return wb.toXlsx();
  } finally {
    await wb.close('skipSave').catch(() => {
      wb.dispose();
    });
  }
}

export async function expectVersionHead(wb: Workbook) {
  const head = await wb.version.getHead();
  expect(head).toMatchObject({ ok: true });
  if (!head.ok) throw new Error(`expected version head: ${head.error.code}`);
  if (!head.value.refRevision) throw new Error('expected version head ref revision');
  return head.value;
}

function localAdvanceSemanticState() {
  return {
    state: {
      schemaVersion: 'semantic-workbook-state.v1',
      workbookId: 'local-advance',
      domains: {},
      sheets: {},
    },
    stateDigest: {
      algorithm: 'sha256',
      value: 'localadvance'.repeat(6).slice(0, 64),
    },
  };
}
