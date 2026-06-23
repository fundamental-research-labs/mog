import { resetVersionStoreIndexedDbForXlsxImportRootTests } from './version-xlsx-import-root-test-utils';

export function installMetadataTrustIndexedDbHooks(): void {
  beforeEach(resetVersionStoreIndexedDbForXlsxImportRootTests);
  afterEach(resetVersionStoreIndexedDbForXlsxImportRootTests);
}
