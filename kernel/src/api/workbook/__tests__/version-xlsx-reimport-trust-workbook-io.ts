import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createWorkbook } from '../create-workbook';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import { withVersionManifest } from './version-domain-support-test-utils';

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
