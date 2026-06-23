import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { DOCUMENT_SCOPE } from './version-diff-provider-fixtures';

export function createDiffProvider() {
  return createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
}
