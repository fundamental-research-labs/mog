import { DOCUMENT_ID, WORKSPACE_ID } from './version-xlsx-reimport-trust-constants';
import { seedTrustedExport, type TrustedExportSeed } from './version-xlsx-reimport-trust-workbook';

export function seedOriginalTrustedExport(): Promise<TrustedExportSeed> {
  return seedTrustedExport({
    documentId: DOCUMENT_ID,
    workspaceId: WORKSPACE_ID,
    a1Value: 'Original',
  });
}
