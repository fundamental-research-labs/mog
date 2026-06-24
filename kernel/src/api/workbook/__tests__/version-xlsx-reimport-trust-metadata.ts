import type { ObjectDigest, WorkbookCommitId } from '@mog-sdk/contracts/api';

import type {
  MogWorkbookVersionXlsxMetadata,
  MogWorkbookVersionXlsxMetadataTrustReason,
} from '../version/xlsx-metadata/xlsx-version-metadata';
import { DOCUMENT_ID, WORKSPACE_ID } from './version-xlsx-reimport-trust-constants';

export function expectMetadataWarning(
  warnings: readonly unknown[],
  reason: MogWorkbookVersionXlsxMetadataTrustReason,
): void {
  expect(warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'import_error',
        reason,
        diagnostic: expect.objectContaining({
          code: 'mogVersionMetadataUntrusted',
          reason,
          details: expect.objectContaining({ redacted: true }),
        }),
      }),
    ]),
  );
}

export function expectNoMetadataWarning(warnings: readonly unknown[]): void {
  expect(warnings).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        diagnostic: expect.objectContaining({ code: 'mogVersionMetadataUntrusted' }),
      }),
    ]),
  );
}

export function expectStaleMetadataWarning(warnings: readonly unknown[]): void {
  expect(warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'import_error',
        reason: 'trusted-stale-base',
        diagnostic: expect.objectContaining({
          code: 'mogVersionMetadataStale',
          reason: 'trusted-stale-base',
          details: expect.objectContaining({
            trusted: true,
            staleBase: true,
            redacted: true,
          }),
        }),
      }),
    ]),
  );
  const serialized = JSON.stringify(warnings);
  expect(serialized).not.toContain(DOCUMENT_ID);
  expect(serialized).not.toContain(WORKSPACE_ID);
  expect(serialized).not.toContain('commit:sha256:');
}

export function testVersionMetadata(
  metadata: MogWorkbookVersionXlsxMetadata,
): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: metadata.exportedAt,
    documentId: metadata.documentId,
    ...(metadata.workspaceId ? { workspaceId: metadata.workspaceId } : {}),
    head: metadata.head ? { ...metadata.head } : null,
    diagnostics: metadata.diagnostics,
    redaction: metadata.redaction,
  };
}

export function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}

export function workbookCommitId(seed: string): WorkbookCommitId {
  return `commit:sha256:${seed.repeat(64).slice(0, 64)}` as WorkbookCommitId;
}
