import type { ObjectDigest, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { createWorkbook } from '../create-workbook';
import {
  addMogVersionMetadataToXlsx,
  MOG_VERSION_METADATA_PART,
  type MogWorkbookVersionXlsxMetadata,
} from '../version/xlsx-metadata/xlsx-version-metadata';
import {
  decodeUtf8,
  encodeUtf8,
  readZipArchive,
  writeStoredZip,
} from './xlsx-clean-export-package-zip-test-utils';

export const TARGET_DOCUMENT_ID = 'vc10-clean-export-package-scan-target';
const SOURCE_DOCUMENT_ID = 'vc10-clean-export-package-scan-source';
const LEAK_DOCUMENT_ID = 'vc10-clean-export-package-scan-leak-document';
const LEAK_REF_REVISION = 'vc10-clean-export-ref-revision-sentinel';
const LEAK_DIAGNOSTIC_SENTINEL = 'vc10-clean-export-diagnostic-sentinel';
const LEAK_REDACTION_SENTINEL = 'vc10-clean-export-redaction-sentinel';
const LEAK_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
const SEMANTIC_CHANGE_SET_DIGEST = objectDigest('d');
const SNAPSHOT_ROOT_DIGEST = objectDigest('e');

export const CLEAN_EXPORT_METADATA_LEAK_TOKENS = [
  LEAK_DOCUMENT_ID,
  LEAK_COMMIT_ID,
  LEAK_REF_REVISION,
  SEMANTIC_CHANGE_SET_DIGEST.digest,
  SNAPSHOT_ROOT_DIGEST.digest,
  LEAK_DIAGNOSTIC_SENTINEL,
  LEAK_REDACTION_SENTINEL,
  'mog.workbookVersion.xlsxMetadata.v1',
  'https://schemas.mog.dev/workbook/version-metadata/1',
];

export async function createLeakySourceXlsx(): Promise<Uint8Array> {
  return addMogMetadataPackageInventory(
    addMogVersionMetadataToXlsx(await createSourceXlsx(), leakMetadata()),
  );
}

async function createSourceXlsx(): Promise<Uint8Array> {
  const wb = await createWorkbook({ documentId: SOURCE_DOCUMENT_ID, userTimezone: 'UTC' });
  try {
    await wb.activeSheet.setCell('A1', 'Clean export package scan');
    await wb.activeSheet.setCell('B1', 10);
    return wb.toXlsx();
  } finally {
    await wb.close('skipSave').catch(() => {
      wb.dispose();
    });
  }
}

function leakMetadata(): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-21T00:00:00.000Z',
    documentId: LEAK_DOCUMENT_ID,
    head: {
      commitId: LEAK_COMMIT_ID,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: { kind: 'opaque', value: LEAK_REF_REVISION },
      semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
      snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
    },
    diagnostics: [{ leakSentinel: LEAK_DIAGNOSTIC_SENTINEL }],
    redaction: {
      policy: 'commit-document-and-object-digests-only',
      omitted: ['authors', 'agentTraces', LEAK_REDACTION_SENTINEL],
    },
  };
}

function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}

function addMogMetadataPackageInventory(xlsxBytes: Uint8Array): Uint8Array {
  const entries = new Map(readZipArchive(xlsxBytes).map((entry) => [entry.name, entry.data]));
  const contentTypes = decodeUtf8(requiredEntry(entries, '[Content_Types].xml'));
  const rootRels = decodeUtf8(requiredEntry(entries, '_rels/.rels'));

  entries.set(
    '[Content_Types].xml',
    encodeUtf8(
      insertBeforeClosingTag(
        contentTypes,
        '</Types>',
        [
          `<Override PartName="/${MOG_VERSION_METADATA_PART}" ContentType="application/vnd.mog.workbook-version-metadata+xml"/>`,
          '<Override PartName="/customXml/mog-version-metadata-props.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>',
        ].join(''),
      ),
    ),
  );
  entries.set(
    '_rels/.rels',
    encodeUtf8(
      insertBeforeClosingTag(
        rootRels,
        '</Relationships>',
        `<Relationship Id="rIdMogVersionMetadata" Type="https://schemas.mog.dev/officeDocument/relationships/mogVersionMetadata" Target="${MOG_VERSION_METADATA_PART}"/>`,
      ),
    ),
  );
  entries.set(
    'customXml/_rels/mog-version-metadata.xml.rels',
    encodeUtf8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rIdMogMetadataProps" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="mog-version-metadata-props.xml"/>',
        '</Relationships>',
      ].join(''),
    ),
  );
  entries.set(
    'customXml/mog-version-metadata-props.xml',
    encodeUtf8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<ds:datastoreItem ds:itemID="{11111111-1111-1111-1111-111111111111}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">',
        '<ds:schemaRefs/>',
        '</ds:datastoreItem>',
      ].join(''),
    ),
  );

  return writeStoredZip(
    Array.from(entries, ([name, data]) => ({
      name,
      data,
    })),
  );
}

function requiredEntry(entries: ReadonlyMap<string, Uint8Array>, name: string): Uint8Array {
  const entry = entries.get(name);
  if (!entry) throw new Error(`missing XLSX package part ${name}`);
  return entry;
}

function insertBeforeClosingTag(xml: string, closingTag: string, insertion: string): string {
  const offset = xml.lastIndexOf(closingTag);
  if (offset === -1) throw new Error(`missing closing XML tag ${closingTag}`);
  return `${xml.slice(0, offset)}${insertion}${xml.slice(offset)}`;
}
