import 'fake-indexeddb/auto';

import type { ObjectDigest, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { createWorkbook } from '../create-workbook';
import type { MogWorkbookVersionXlsxMetadata } from '../xlsx-version-metadata';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
} from '../../../document/version-store/provider-registry';

export const DOCUMENT_ID = 'vc10-xlsx-import-root';
export const CLEAN_EXPORT_DOCUMENT_ID = 'vc10-xlsx-clean-export';
export const METADATA_EXPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-export';
export const METADATA_REPLACE_DOCUMENT_ID = 'vc10-xlsx-metadata-replace';
export const METADATA_TRUST_DOCUMENT_ID = 'vc10-xlsx-metadata-trust';
export const METADATA_TRUST_REIMPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-trust-reimport';
export const OLD_METADATA_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
export const OTHER_METADATA_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
export const SEMANTIC_CHANGE_SET_DIGEST = objectDigest('1');
export const SNAPSHOT_ROOT_DIGEST = objectDigest('2');
export const OTHER_SEMANTIC_CHANGE_SET_DIGEST = objectDigest('3');
export const OTHER_SNAPSHOT_ROOT_DIGEST = objectDigest('4');
export const REF_REVISION = { kind: 'counter', value: '1' } as const;
export const OTHER_REF_REVISION = { kind: 'counter', value: '2' } as const;
export const RAW_METADATA_DIAGNOSTIC_SECRET = 'vc10-raw-metadata-diagnostic-secret';

export async function resetVersionStoreIndexedDbForXlsxImportRootTests(): Promise<void> {
  await deleteVersionStoreIndexedDbForTesting();
}

export function durableIndexedDbVersioning() {
  return {
    providerSelection: {
      kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      requireDurablePersistence: true,
    },
  } as const;
}

export async function createSourceXlsx(a1Value = 'Imported'): Promise<Uint8Array> {
  const wb = await createWorkbook({ documentId: 'vc10-xlsx-import-source', userTimezone: 'UTC' });
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

export async function readRootSemanticChangeSetPayload(
  rootCommitId: WorkbookCommitId,
  documentId = DOCUMENT_ID,
): Promise<Record<string, unknown>> {
  const { graph, root } = await readRootCommit(rootCommitId, documentId);
  const semanticRecord = await graph.getObjectRecord({
    kind: 'object',
    objectType: 'workbook.semanticChangeSet.v1',
    digest: root.commit.payload.semanticChangeSetDigest,
  });
  return semanticRecord.preimage.payload as Record<string, unknown>;
}

export async function readRootCommitPayload(
  rootCommitId: WorkbookCommitId,
  documentId = DOCUMENT_ID,
): Promise<Record<string, unknown>> {
  const { root } = await readRootCommit(rootCommitId, documentId);
  return root.commit.payload as unknown as Record<string, unknown>;
}

export async function expectContractedXlsxExportBlocked(
  exportAttempt: Promise<Uint8Array>,
): Promise<void> {
  await expect(exportAttempt).rejects.toMatchObject({
    name: 'MogSdkError',
    code: 'EXPORT_ERROR',
    operation: 'workbook.toXlsx',
    diagnostics: {
      domain: 'VERSION',
      issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
      severity: 'error',
    },
    details: {
      issue: 'export-domain-support-manifest-blocked',
      operation: 'workbook.toXlsx',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'export',
          }),
        }),
      ]),
    },
  });
}

export function testVersionMetadata(input: {
  readonly documentId: string;
  readonly commitId: WorkbookCommitId;
  readonly refRevision?: NonNullable<MogWorkbookVersionXlsxMetadata['head']>['refRevision'];
  readonly semanticChangeSetDigest?: ObjectDigest;
  readonly snapshotRootDigest?: ObjectDigest;
}): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-21T00:00:00.000Z',
    documentId: input.documentId,
    head: {
      commitId: input.commitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      ...(input.refRevision ? { refRevision: input.refRevision } : {}),
      ...(input.semanticChangeSetDigest
        ? { semanticChangeSetDigest: input.semanticChangeSetDigest }
        : {}),
      ...(input.snapshotRootDigest ? { snapshotRootDigest: input.snapshotRootDigest } : {}),
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

async function readRootCommit(rootCommitId: WorkbookCommitId, documentId: string) {
  const documentScope: VersionDocumentScope = { documentId };
  const provider = selectVersionStoreProvider(
    {
      kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      documentScope,
      requireDurablePersistence: true,
    },
    createDefaultVersionStoreProviderRegistry(),
  );
  const registry = await provider.readGraphRegistry();
  expect(registry.status).toBe('ok');
  if (registry.status !== 'ok') {
    throw new Error(`expected version registry: ${registry.diagnostics[0]?.code}`);
  }
  const graph = await provider.openGraph(
    namespaceForDocumentScope(documentScope, registry.registry.currentGraphId),
  );
  const root = await graph.readCommit(rootCommitId);
  expect(root.status).toBe('success');
  if (root.status !== 'success') {
    throw new Error(`expected root commit: ${root.diagnostics[0]?.code}`);
  }
  return { graph, root };
}

function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}
