import 'fake-indexeddb/auto';

import { inflateRawSync } from 'node:zlib';

import type { Workbook, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createWorkbook } from '../create-workbook';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
} from '../../../document/version-store/provider-registry';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';

const DOCUMENT_ID = 'vc10-xlsx-import-root';
const CLEAN_EXPORT_DOCUMENT_ID = 'vc10-xlsx-clean-export';
const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('WorkbookVersion XLSX import root', () => {
  it('initializes a durable semantic import-root commit for XLSX imports', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    let reopenedWb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: {
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        },
      });

      const head = await wb.version.getHead();
      expect(head).toMatchObject({
        ok: true,
        value: {
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);
      const rootCommitId = head.value.id;

      await expect(wb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: [
            expect.objectContaining({
              id: rootCommitId,
              parents: [],
              author: expect.objectContaining({
                actorKind: 'system',
                displayName: 'Mog XLSX Import',
              }),
            }),
          ],
        },
      });
      await expect(wb.version.commit({ mode: { kind: 'import-root' } })).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          diagnostics: [expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' })],
        },
      });

      const semanticPayload = await readRootSemanticChangeSetPayload(rootCommitId);
      expect(semanticPayload).toMatchObject({
        schemaVersion: 1,
        source: {
          kind: 'xlsxImportRoot',
          source: {
            sourceType: 'bytes',
            byteLength: xlsxBytes.byteLength,
          },
        },
        importDiagnostics: expect.any(Array),
        changes: [],
      });
      expect(semanticPayload).toHaveProperty('semanticState.stateDigest');
      expect(semanticPayload).not.toHaveProperty('xlsxBytes');
      expect(semanticPayload).not.toHaveProperty('rawBytes');

      await wb.close('skipSave');
      wb = undefined;
      await imported.handle.dispose();

      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({
        versioning: {
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        },
      });

      await expect(reopenedWb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: { id: rootCommitId },
      });
    } finally {
      await reopenedWb?.close('skipSave').catch(() => {});
      await reopenedHandle?.dispose().catch(() => {});
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('exports clean XLSX bytes without Mog version metadata package parts', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: CLEAN_EXPORT_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      await expect(wb.version.getHead()).resolves.toMatchObject({ ok: true });

      const exported = await wb.toXlsx({ contextStripped: true });
      expect(findMogVersionMetadataEvidence(exported)).toEqual([]);
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });
});

async function createSourceXlsx(): Promise<Uint8Array> {
  const wb = await createWorkbook({ documentId: 'vc10-xlsx-import-source', userTimezone: 'UTC' });
  try {
    await wb.activeSheet.setCell('A1', 'Imported');
    await wb.activeSheet.setCell('B1', 42);
    return wb.toXlsx();
  } finally {
    await wb.close('skipSave').catch(() => {
      wb.dispose();
    });
  }
}

async function readRootSemanticChangeSetPayload(
  rootCommitId: WorkbookCommitId,
): Promise<Record<string, unknown>> {
  const provider = selectVersionStoreProvider(
    {
      kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      documentScope: DOCUMENT_SCOPE,
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
    namespaceForDocumentScope(DOCUMENT_SCOPE, registry.registry.currentGraphId),
  );
  const root = await graph.readCommit(rootCommitId);
  expect(root.status).toBe('success');
  if (root.status !== 'success') {
    throw new Error(`expected root commit: ${root.diagnostics[0]?.code}`);
  }
  const semanticRecord = await graph.getObjectRecord({
    kind: 'object',
    objectType: 'workbook.semanticChangeSet.v1',
    digest: root.commit.payload.semanticChangeSetDigest,
  });
  return semanticRecord.preimage.payload as Record<string, unknown>;
}

interface ZipEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
}

function findMogVersionMetadataEvidence(xlsxBytes: Uint8Array): string[] {
  const archive = readZipArchive(xlsxBytes);
  const evidence: string[] = [];
  for (const entry of archive.entries) {
    if (isMogVersionMetadataPackagePart(entry.name)) {
      evidence.push(entry.name);
    }
  }
  for (const packageMetadataPart of ['[Content_Types].xml', '_rels/.rels']) {
    const text = archive.readText(packageMetadataPart);
    if (text && containsMogVersionMetadataMarker(text)) {
      evidence.push(packageMetadataPart);
    }
  }
  return evidence;
}

function isMogVersionMetadataPackagePart(entryName: string): boolean {
  const normalized = normalizePackageText(entryName);
  return (
    normalized === 'docprops/custom.xml' ||
    normalized.startsWith('customxml/') ||
    containsMogVersionMetadataMarker(normalized)
  );
}

function containsMogVersionMetadataMarker(value: string): boolean {
  const normalized = normalizePackageText(value);
  return (
    normalized.includes('mog-version') ||
    normalized.includes('mog_version') ||
    normalized.includes('mog/version') ||
    normalized.includes('version-control') ||
    normalized.includes('versioncontrol') ||
    normalized.includes('application/vnd.mog')
  );
}

function normalizePackageText(value: string): string {
  return value.replace(/^\/+/, '').toLowerCase();
}

function readZipArchive(bytes: Uint8Array): {
  readonly entries: readonly ZipEntry[];
  readonly readText: (name: string) => string | null;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readZipEntries(bytes, view);
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    entries,
    readText(name: string): string | null {
      const entry = entriesByName.get(name);
      if (!entry) return null;
      return new TextDecoder().decode(readZipEntry(bytes, view, entry));
    },
  };
}

function readZipEntries(bytes: Uint8Array, view: DataView): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(view);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;
  while (offset < end) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`invalid ZIP central directory header at ${offset}`);
    }
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(bytes: Uint8Array, view: DataView, entry: ZipEntry): Uint8Array {
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error(`invalid ZIP local file header for ${entry.name}`);
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) {
    return compressed;
  }
  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressed);
  }
  throw new Error(
    `unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}`,
  );
}

function findEndOfCentralDirectory(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error('missing ZIP end of central directory');
}
