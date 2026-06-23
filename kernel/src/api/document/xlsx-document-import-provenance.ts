import type { DocumentSource } from '@mog-sdk/contracts/document';
import type { XlsxVersionImportRootProvenance } from '../../document/version-store/xlsx-import-root';

export function xlsxImportRootSource(
  source: DocumentSource,
): XlsxVersionImportRootProvenance['source'] {
  if (source.type === 'bytes') {
    return { sourceType: 'bytes', byteLength: source.data.byteLength };
  }
  return { sourceType: 'path', pathRedacted: true };
}
